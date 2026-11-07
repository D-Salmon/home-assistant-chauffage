"""Persistent dynamic room registry and local heating coordinator."""
import asyncio
from copy import deepcopy
from datetime import timedelta
import logging
import time

from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, EVENT_HOMEASSISTANT_STOP, EVENT_STATE_CHANGED
from homeassistant.core import callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .model import change, decide, initial_data, supported_temperature, target
from .learning import add_sample, estimate_minutes, upcoming_block

DOMAIN = "ma_maison_chauffage"
SIGNAL = DOMAIN + "_updated"
_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry):
    from .frontend import async_setup_frontend
    await async_setup_frontend(hass)
    runtime = HeatingRuntime(hass, entry.entry_id, entry.options.get("house_name", "Ma maison"))
    await runtime.load()
    hass.data[DOMAIN] = runtime
    entry.async_on_unload(entry.add_update_listener(async_update_options))
    hass.services.async_register(DOMAIN, "command", runtime.command)
    await hass.config_entries.async_forward_entry_setups(entry, ["sensor"])
    runtime.subscribe()
    if hass.is_running:
        await runtime.start()
    else:
        runtime.unsubs.append(hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, runtime.start))
    return True


async def async_update_options(hass, entry):
    """Apply the display name without unloading the relay controller."""
    runtime = hass.data.get(DOMAIN)
    if runtime:
        runtime.house_name = entry.options.get("house_name", "Ma maison")
        runtime.data["settings"]["house_name"] = runtime.house_name
        runtime.data["revision"] += 1
        await runtime.persist()
        async_dispatcher_send(hass, SIGNAL)


async def async_unload_entry(hass, entry):
    runtime = hass.data[DOMAIN]
    # Stop requesting heat before an intentional unload. Failure refuses unload.
    if not await runtime.stop():
        return False
    if not await hass.config_entries.async_unload_platforms(entry, ["sensor"]):
        runtime.subscribe()
        await runtime.start()
        return False
    hass.services.async_remove(DOMAIN, "command")
    hass.data.pop(DOMAIN, None)
    return True


class HeatingRuntime:
    def __init__(self, hass, entry_id, house_name="Ma maison"):
        self.hass = hass
        self.house_name = house_name
        self.store = Store(hass, 1, DOMAIN + "." + entry_id, atomic_writes=True)
        self.data = initial_data()
        self.memory = {}
        self.learning = {}
        self.schedule_data = None
        self.schedule_data_at = 0
        self.status = {"rooms": [], "faults": [], "relay": "unknown"}
        self.lock = asyncio.Lock()
        self.unsubs = []
        self.started = False
        self.reset = True
        self.tasks = {}
        self.command_errors = {}
        self.retry_after = {}
        self.limit = asyncio.Semaphore(4)
        self.last_notice = None

    async def load(self):
        saved = await self.store.async_load()
        if saved:
            self.data = saved["configuration"]
            self.memory = saved.get("memory", {})
            self.learning = saved.get("learning", {})
        had_house_name = "house_name" in self.data["settings"]
        for key, value in initial_data()["settings"].items():
            self.data["settings"].setdefault(key, value)
        if not had_house_name:
            self.data["settings"]["house_name"] = self.house_name

    async def persist(self):
        await self.store.async_save({"configuration": deepcopy(self.data), "memory": deepcopy(self.memory), "learning": deepcopy(self.learning)})

    @callback
    def subscribe(self):
        self.unsubs.append(async_track_time_interval(self.hass, self.tick, timedelta(seconds=15)))
        self.unsubs.append(self.hass.bus.async_listen(EVENT_STATE_CHANGED, self.state_changed))
        self.unsubs.append(self.hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, self.shutdown))

    @callback
    def state_changed(self, event):
        s = self.data["settings"]
        watched = {s["relay"], s["active_schedule"]}
        watched.update(r["entity"] for r in self.data["rooms"])
        watched.update(r.get("pause_entity", "") for r in self.data["rooms"] if r.get("pause_entity"))
        watched.update(r["last_seen"] for r in self.data["rooms"] if r["last_seen"])
        entity = event.data.get("entity_id")
        if self.started and entity in watched and not self.lock.locked():
            self.hass.async_create_task(self.tick())

    async def start(self, _event=None):
        self.started = True
        self.reset = True
        await self.tick()

    async def stop(self):
        async with self.lock:
            relay = self.data["settings"]["relay"]
            if relay:
                try:
                    await self.service("switch", "turn_off", {"entity_id": relay})
                except Exception:
                    _LOGGER.exception("Impossible de demander l’arrêt du relais avant déchargement")
                    return False
            self.started = False
            for task in self.tasks.values():
                task.cancel()
            self.tasks.clear()
            for unsub in self.unsubs:
                unsub()
            self.unsubs.clear()
            await self.persist()
            return True

    async def shutdown(self, _event):
        await self.stop()

    async def service(self, domain, action, data, return_response=False):
        async with asyncio.timeout(8):
            kwargs = {"blocking": True}
            if return_response:
                kwargs["return_response"] = True
            return await self.hass.services.async_call(domain, action, data, **kwargs)

    async def command(self, call):
        # Both room administration and controls require an administrator in v3.
        user = await self.hass.auth.async_get_user(call.context.user_id) if call.context.user_id else None
        if user is None or not user.is_admin:
            raise ServiceValidationError("Un compte administrateur est requis.")
        async with self.lock:
            if call.data.get("revision") != self.data["revision"]:
                raise ServiceValidationError("Les réglages ont changé ailleurs. Rechargez la carte.")
            operation = call.data.get("operation")
            new_learning = deepcopy(self.learning)
            try:
                new = change(self.data, operation, call.data.get("payload", {}), time.time())
                if operation in ("save_room", "remove_room"):
                    old_rooms = {r["id"]: r for r in self.data["rooms"]}
                    new_rooms = {r["id"]: r for r in new["rooms"]}
                    for room_id, old_room in old_rooms.items():
                        if room_id not in new_rooms or new_rooms[room_id]["entity"] != old_room["entity"]:
                            new_learning.pop(room_id, None)
                if operation == "save_room":
                    requested = call.data.get("payload", {}).get("entity")
                    old_entities = {r["entity"] for r in self.data["rooms"]}
                    if requested and requested not in old_entities and self.hass.states.get(requested) is None:
                        raise ValueError("Vanne introuvable : " + requested)
                settings, previous = new["settings"], self.data["settings"]
                if settings["relay"] != previous["relay"]:
                    old = self.hass.states.get(previous["relay"]) if previous["relay"] else None
                    if settings["enabled"] or previous["enabled"] or (previous["relay"] and (old is None or old.state != "off")):
                        raise ValueError("Arrêtez le chauffage et vérifiez que l’ancien relais est OFF avant de le remplacer.")
                if settings["enabled"] and not previous["enabled"]:
                    relay = self.hass.states.get(settings["relay"])
                    if relay is None or relay.state not in ("on", "off"):
                        raise ValueError("Le relais doit être disponible pour autoriser le chauffage.")
                if "schedules" in call.data.get("payload", {}) and operation == "settings":
                    for schedule in settings["schedules"]:
                        if self.hass.states.get(schedule["entity"]) is None:
                            raise ValueError("Planning introuvable : " + schedule["entity"])
            except (ValueError, TypeError, KeyError) as exc:
                raise ServiceValidationError(str(exc)) from exc
            # Durable save precedes replacing the live model and sending orders.
            await self.store.async_save({"configuration": deepcopy(new), "memory": deepcopy(self.memory), "learning": deepcopy(new_learning)})
            self.data = new
            self.learning = new_learning
            if settings["active_schedule"] != previous["active_schedule"]:
                self.schedule_data = None
                self.schedule_data_at = 0
            self.command_errors.clear()
            self.retry_after.clear()
            for task in self.tasks.values():
                task.cancel()
            self.tasks.clear()
            if operation == "retry" or settings["relay"] != previous["relay"]:
                self.reset = True
            self.publish()
        await self.tick()

    def snapshot(self, entity):
        state = self.hass.states.get(entity) if entity else None
        return {"state": state.state, "attributes": dict(state.attributes)} if state else None

    def desired_target(self, room, schedule, now):
        settings = self.data["settings"]
        value, profile = target(room, settings, schedule, now)
        if not (settings["enabled"] and settings["anticipation_enabled"] and not settings["absent"]
                and room["mode"] == "planning" and not room.get("override") and value is not None):
            return value, profile
        next_time, next_profile = upcoming_block(self.schedule_data, dt_util.now())
        if next_time is None:
            return value, profile
        minutes = (next_time - now) / 60
        state = self.snapshot(room["entity"])
        current = state["attributes"].get("current_temperature") if state else None
        outdoor_state = self.snapshot(settings.get("outdoor_sensor", ""))
        try:
            outdoor = float(outdoor_state["state"]) if outdoor_state and outdoor_state["attributes"].get("unit_of_measurement") == "°C" else None
        except (TypeError, ValueError):
            outdoor = None
        samples = self.learning.get(room["id"], [])
        next_target = room["temperatures"].get(next_profile)
        if next_target is None or next_target == value:
            return value, profile
        if next_target > value:
            lead, _ = estimate_minutes(samples, current, next_target, now, settings["anticipation_window_days"], True, outdoor)
            if minutes <= lead:
                return next_target, "anticipation chauffe"
        elif next_target < value:
            lead, _ = estimate_minutes(samples, current, next_target, now, settings["anticipation_window_days"], False, outdoor)
            if minutes <= lead:
                return next_target, "anticipation arrêt"
        return value, profile

    def room_paused(self, room, now):
        entity = room.get("pause_entity", "")
        if not entity:
            return False
        state = self.snapshot(entity)
        return bool(not state or state["state"] in ("unknown", "unavailable", "on"))

    @callback
    def publish(self):
        async_dispatcher_send(self.hass, SIGNAL)

    def queue_setpoint(self, room, temperature, now):
        key = room["id"]
        if key in self.tasks or now < self.retry_after.get(key, 0):
            return
        revision = self.data["revision"]
        task = self.hass.async_create_task(self.setpoint(room, temperature, revision))
        self.tasks[key] = task
        def done(finished):
            if self.tasks.get(key) is finished:
                self.tasks.pop(key, None)
        task.add_done_callback(done)

    def queue_pause(self, room):
        key = room["id"]
        if key in self.tasks:
            return
        task = self.hass.async_create_task(self.pause_valve(room))
        self.tasks[key] = task
        task.add_done_callback(lambda finished: self.tasks.pop(key, None) if self.tasks.get(key) is finished else None)

    async def pause_valve(self, room):
        try:
            async with self.limit:
                if not self.started or not self.room_paused(room, time.time()):
                    return
                state = self.snapshot(room["entity"])
                if state and state["state"] == "heat":
                    await self.service("climate", "set_hvac_mode", {"entity_id": room["entity"], "hvac_mode": "off"})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.command_errors[room["id"]] = "Pause impossible : " + str(exc)
            _LOGGER.warning("Mise en pause impossible pour %s: %s", room["entity"], exc)

    async def setpoint(self, room, value, revision):
        try:
            async with self.limit:
                if not self.started or self.data["revision"] != revision or not self.data["settings"]["enabled"] or self.room_paused(room, time.time()):
                    return
                if self.desired_target(room, self.snapshot(self.data["settings"]["active_schedule"]), time.time())[0] != value:
                    return
                current = self.snapshot(room["entity"])
                if not current or current["state"] in ("unknown", "unavailable"):
                    return
                if current["state"] != "heat":
                    await self.service("climate", "set_hvac_mode", {"entity_id": room["entity"], "hvac_mode": "heat"})
                if self.data["revision"] != revision or not self.data["settings"]["enabled"] or self.room_paused(room, time.time()):
                    return
                if self.desired_target(room, self.snapshot(self.data["settings"]["active_schedule"]), time.time())[0] != value:
                    return
                if current["attributes"].get("temperature") != value:
                    await self.service("climate", "set_temperature", {"entity_id": room["entity"], "temperature": value})
                self.command_errors.pop(room["id"], None)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.command_errors[room["id"]] = "Consigne non envoyée : " + str(exc)
            _LOGGER.warning("Envoi de consigne impossible pour %s: %s", room["entity"], exc)
        finally:
            # Also limits repeated requests while a battery device acknowledges slowly.
            self.retry_after[room["id"]] = time.time() + 30

    async def tick(self, _now=None):
        try:
            await self.control_tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            _LOGGER.exception("Erreur du contrôleur chauffage ; arrêt demandé")
            self.reset = True
            self.status["faults"] = ["Erreur interne ou stockage indisponible : arrêt chaudière demandé. Consulter les journaux HA."]
            relay = self.data["settings"]["relay"]
            if relay:
                try:
                    await self.service("switch", "turn_off", {"entity_id": relay})
                except Exception:
                    _LOGGER.exception("La demande d’arrêt de secours a échoué")
            self.publish()

    async def control_tick(self):
        if not self.started or self.lock.locked():
            return
        async with self.lock:
            now, s = time.time(), self.data["settings"]
            schedule = self.snapshot(s["active_schedule"])
            if s["enabled"] and s["anticipation_enabled"] and s["active_schedule"]:
                if self.schedule_data is None or now - self.schedule_data_at >= 600:
                    try:
                        response = await self.service("schedule", "get_schedule", {"entity_id": s["active_schedule"]}, return_response=True)
                        self.schedule_data = response.get(s["active_schedule"]) if isinstance(response, dict) else None
                        self.schedule_data_at = now
                    except Exception:
                        _LOGGER.debug("Impossible de lire le planning pour l’anticipation", exc_info=True)
            heating, faults, rows = [], [], []
            learning_changed = False
            for room in self.data["rooms"]:
                state = self.snapshot(room["entity"])
                paused = self.room_paused(room, now)
                value, profile = (None, "pause") if paused else self.desired_target(room, schedule, now)
                attrs = state["attributes"] if state else {}
                current_temp = attrs.get("current_temperature")
                learned = self.learning.get(room["id"], [])
                outdoor_state = self.snapshot(s.get("outdoor_sensor", ""))
                try:
                    outdoor_temp = float(outdoor_state["state"]) if outdoor_state and outdoor_state["attributes"].get("unit_of_measurement") == "°C" else None
                except (TypeError, ValueError):
                    outdoor_temp = None
                warm_minutes, warm_count = estimate_minutes(learned, current_temp, room["temperatures"]["confort"], now, s["anticipation_window_days"], True, outdoor_temp)
                cool_minutes, cool_count = estimate_minutes(learned, current_temp, room["temperatures"]["eco"], now, s["anticipation_window_days"], False, outdoor_temp)
                anticipating = profile == "anticipation chauffe"
                stopping_early = profile == "anticipation arrêt"
                fault = None
                if not state or state["state"] in ("unknown", "unavailable"):
                    fault = "Vanne indisponible"
                elif attrs.get("hvac_action") not in ("heating", "idle", "off"):
                    fault = "État de chauffe inconnu"
                elif s["enabled"] and value is None and not paused:
                    fault = profile
                elif value is not None and not supported_temperature(attrs, value):
                    fault = "Consigne hors limites de la vanne"
                if room["last_seen"]:
                    seen = self.snapshot(room["last_seen"])
                    stamp = dt_util.parse_datetime(seen["state"]) if seen else None
                    if stamp is None or not -60 <= now - stamp.timestamp() <= s["freshness_minutes"] * 60:
                        fault = "Dernier contact trop ancien"
                if (s["enabled"] and attrs.get("hvac_action") in ("heating", "idle") and fault is None
                        and isinstance(current_temp, (int, float))):
                    samples, changed = add_sample(learned, now, current_temp, attrs.get("hvac_action") == "heating", s["anticipation_window_days"], outdoor_temp)
                    if changed or samples != learned:
                        self.learning[room["id"]] = samples
                        learning_changed = True
                if value is not None and state and state["state"] not in ("unknown", "unavailable") and fault not in ("Consigne hors limites de la vanne", "Dernier contact trop ancien"):
                    if state["state"] != "heat" or attrs.get("temperature") != value or room["id"] in self.command_errors:
                        self.queue_setpoint(room, value, now)
                elif paused and state and state["state"] == "heat":
                    self.queue_pause(room)
                fault = fault or self.command_errors.get(room["id"])
                if fault:
                    faults.append(room["name"] + " : " + fault)
                elif s["enabled"] and not paused and attrs.get("hvac_action") == "heating":
                    heating.append(room["id"])
                rows.append({"id": room["id"], "current_temperature": attrs.get("current_temperature"),
                             "temperature": attrs.get("temperature"), "target": value, "profile": profile,
                             "hvac_action": attrs.get("hvac_action"), "fault": fault,
                             "anticipation_minutes": round(warm_minutes), "anticipation_cool_minutes": round(cool_minutes),
                             "learning_samples": warm_count, "learning_cool_samples": cool_count,
                             "anticipating": anticipating or stopping_early, "paused": paused})
            relay = self.snapshot(s["relay"])
            actual = relay["state"] if relay else "unknown"
            memory, send = decide(s, len(rows), heating, faults, actual, self.memory, now, self.reset)
            self.reset = False
            changed = memory != self.memory
            self.memory = memory
            if changed or learning_changed:
                await self.persist()
            if send and s["relay"]:
                try:
                    await self.service("switch", "turn_" + memory["desired"], {"entity_id": s["relay"]})
                except Exception as exc:
                    faults.append("Commande relais impossible : " + str(exc))
            if actual != memory["desired"] and memory["attempts"] >= 3 and now - memory["last_attempt"] >= 15:
                faults.append("Relais non confirmé après trois tentatives. Vérifier puis cliquer Réessayer.")
            self.status = {"rooms": rows, "faults": faults, "relay": actual, "requested": memory["desired"], "heating_count": len(heating)}
            notice = "\n".join(faults)
            if notice != self.last_notice:
                self.last_notice = notice
                try:
                    await self.service("persistent_notification", "create" if notice else "dismiss",
                                       {"notification_id": DOMAIN, **({"title": "Ma maison : chauffage", "message": notice} if notice else {})})
                except Exception:
                    _LOGGER.debug("Notification indisponible", exc_info=True)
            self.publish()

