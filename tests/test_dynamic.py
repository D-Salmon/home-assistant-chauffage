"""Unit and adapter tests. HA services/storage are simulated, not a live HA install."""
import asyncio
from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components/ma_maison_chauffage"
spec = importlib.util.spec_from_file_location("heating_model", COMPONENT / "model.py")
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)


def room(data, index=0, **extra):
    return model.change(data, "save_room", {"name": f"Pièce {index}", "entity": f"climate.room_{index}", **extra}, 1000)


class ModelTests(unittest.TestCase):
    def test_any_room_count_and_remove_last(self):
        for count in (0, 1, 8, 20, 50):
            data = model.initial_data()
            for index in range(count):
                data = room(data, index)
            self.assertEqual(len(data["rooms"]), count)
            self.assertEqual(len({r["id"] for r in data["rooms"]}), count)
            while data["rooms"]:
                data = model.change(data, "remove_room", {"id": data["rooms"][0]["id"]}, 1000)
            settings = data["settings"] | {"enabled": True}
            decision, send = model.decide(settings, 0, [], [], "on", {}, 1000)
            self.assertEqual(decision["desired"], "off")
            self.assertTrue(send)

    def test_duplicate_and_invalid_transaction(self):
        data = room(model.initial_data())
        before = deepcopy(data)
        invalid = [dict(entity="climate.room_0", name="Duplicate"),
                   dict(entity="switch.bad", name="Bad"),
                   dict(entity="climate.other", name=""),
                   dict(entity="climate.other", name="Bad", temperatures={"eco": 1}),
                   dict(entity="climate.other", name="Bad", id=""),
                   dict(entity="climate.other", name="Bad", mode="invalid")]
        for payload in invalid:
            with self.assertRaises(ValueError):
                model.change(data, "save_room", payload, 1000)
            self.assertEqual(data, before)
        for value in (True, float("nan"), float("inf"), 4, 25.5, 18.25, "20"):
            with self.assertRaises(ValueError):
                model.temperature(value)

    def test_all_profiles_and_durable_override(self):
        data = room(model.initial_data())
        r = data["rooms"][0]
        r["temperatures"] = dict(confort=21, eco=18, nuit=17, absent=13)
        settings = data["settings"] | {"enabled": True}
        for p, value in r["temperatures"].items():
            schedule = {"state": "on", "attributes": {"profil": p}}
            self.assertEqual(model.target(r, settings, schedule, 1000), (value, p))
        self.assertEqual(model.target(r, settings, {"state": "off"}, 1000), (18, "eco"))
        self.assertEqual(model.target(r, settings, None, 1000)[0], None)
        r["override"] = {"temperature": 23, "until": 1100}
        self.assertEqual(model.target(r, settings, None, 1099), (23, "manuel"))
        self.assertEqual(model.target(deepcopy(r), settings, {"state": "off"}, 1100), (18, "eco"))
        r["mode"] = "absent"
        self.assertEqual(model.target(r, settings, None, 1000), (13, "absent"))
        r["mode"] = "confort"
        self.assertEqual(model.target(r, settings | {"absent": True}, None, 1000), (13, "absent"))

    def test_malformed_device_limits(self):
        self.assertTrue(model.supported_temperature({}, 20))
        for attrs in ({"min_temp": None}, {"max_temp": "unknown"}, {"max_temp": float("nan")}, {"min_temp": 30}, {"max_temp": 15}):
            self.assertFalse(model.supported_temperature(attrs, 20))

    def test_rename_preserves_profiles_id_and_override(self):
        data = room(model.initial_data())
        r = data["rooms"][0]
        r["override"] = {"temperature": 22, "until": 2000}
        updated = model.change(data, "save_room", {"id": r["id"], "name": "Chambre enfant"}, 1000)
        self.assertEqual(updated["rooms"][0]["override"], r["override"])
        self.assertEqual(updated["rooms"][0]["temperatures"], r["temperatures"])
        fixed = model.change(updated, "save_room", {"id": r["id"], "mode": "absent"}, 1000)
        self.assertIsNone(fixed["rooms"][0]["override"])
        resumed = model.change(fixed, "resume", {"id": r["id"]}, 1000)
        self.assertEqual(resumed["rooms"][0]["mode"], "planning")

    def test_absence_and_schedule_keep_permanent_room_modes(self):
        data = room(model.initial_data(), mode="absent")
        data = room(data, 1)
        data["rooms"][1]["override"] = {"temperature": 22, "until": 2000}
        data = model.change(data, "settings", {"absent": True}, 1000)
        self.assertEqual(data["rooms"][0]["mode"], "absent")
        self.assertIsNone(data["rooms"][1]["override"])
        data = model.change(data, "settings", {"absent": False}, 1000)
        self.assertEqual(data["rooms"][0]["mode"], "absent")

    def test_relay_delays_failure_retries_and_restart(self):
        s = model.initial_data()["settings"] | {"enabled": True}
        old, send = model.decide(s, 20, ["one"], [], "off", {}, 1000, True)
        self.assertFalse(send)
        old, _ = model.decide(s, 20, ["one"], [], "off", old, 1179)
        self.assertEqual(old["desired"], "off")
        old, send = model.decide(s, 20, ["one"], [], "off", old, 1180)
        self.assertTrue(send)
        for now, expected in [(1181, False), (1195, True), (1210, True), (1225, False)]:
            old, send = model.decide(s, 20, ["one"], [], "off", old, now)
            self.assertEqual(send, expected)
        old, _ = model.decide(s, 20, ["one"], [], "on", old, 1240)
        old, _ = model.decide(s, 20, [], [], "on", old, 1245)
        self.assertEqual(old["desired"], "on")
        old, send = model.decide(s, 20, [], [], "on", old, 1275)
        self.assertTrue(send)
        self.assertEqual(old["desired"], "off")
        forced, _ = model.decide(s, 20, [], ["bad"], "on", {}, 1280)
        self.assertEqual(forced["desired"], "off")
        stop, _ = model.decide(s | {"enabled": False}, 20, ["one"], [], "on", {}, 1280)
        self.assertEqual(stop["desired"], "off")
        restart, _ = model.decide(s, 20, ["one"], [], "off", old, 1400, True)
        self.assertEqual(restart["off_since"], 1400)


# Load the actual HA adapter against narrow, explicit service/storage doubles.
class Store:
    def __init__(self, *args, **kwargs):
        self.value = None
        self.fail = False
    async def async_load(self):
        return deepcopy(self.value)
    async def async_save(self, data):
        if self.fail:
            raise OSError("disk full")
        self.value = deepcopy(data)


class ServiceValidationError(Exception):
    pass


def stub(name, **members):
    module = ModuleType(name)
    module.__dict__.update(members)
    sys.modules[name] = module


stub("homeassistant")
stub("homeassistant.const", EVENT_HOMEASSISTANT_STARTED="started", EVENT_HOMEASSISTANT_STOP="stop", EVENT_STATE_CHANGED="state")
stub("homeassistant.core", callback=lambda f: f)
stub("homeassistant.exceptions", ServiceValidationError=ServiceValidationError)
stub("homeassistant.helpers")
stub("homeassistant.helpers.dispatcher", async_dispatcher_send=lambda *a: None)
stub("homeassistant.helpers.event", async_track_time_interval=lambda *a: lambda: None)
stub("homeassistant.helpers.storage", Store=Store)
stub("homeassistant.util", dt=SimpleNamespace(parse_datetime=lambda s: None))
spec = importlib.util.spec_from_file_location("dynamic_adapter", COMPONENT / "__init__.py", submodule_search_locations=[str(COMPONENT)])
adapter = importlib.util.module_from_spec(spec)
sys.modules["dynamic_adapter"] = adapter
spec.loader.exec_module(adapter)


class FakeHass:
    def __init__(self):
        self.entities = {"switch.boiler": SimpleNamespace(state="off", attributes={})}
        self.states = SimpleNamespace(get=lambda e: self.entities.get(e))
        self.auth = SimpleNamespace(async_get_user=self.user)
        self.services = SimpleNamespace(async_call=self.call)
        self.calls = []
        self.fail_climate = False
        self.admin = True
    async def user(self, _id):
        return SimpleNamespace(is_admin=self.admin)
    def async_create_task(self, coro):
        return asyncio.create_task(coro)
    async def call(self, domain, action, data, blocking):
        self.calls.append((domain, action, deepcopy(data)))
        if domain == "climate":
            if self.fail_climate:
                raise RuntimeError("Zigbee unavailable")
            state = self.entities[data["entity_id"]]
            if action == "set_hvac_mode":
                state.state = data["hvac_mode"]
            if action == "set_temperature":
                state.attributes["temperature"] = data["temperature"]
        if domain == "switch":
            self.entities[data["entity_id"]].state = action.removeprefix("turn_")


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.hass = FakeHass()
        self.runtime = adapter.HeatingRuntime(self.hass, "test")
        await self.runtime.load()
        self.runtime.started = True

    async def asyncTearDown(self):
        for task in list(self.runtime.tasks.values()):
            task.cancel()
        if self.runtime.tasks:
            await asyncio.gather(*list(self.runtime.tasks.values()), return_exceptions=True)

    async def command(self, operation, payload, revision=None):
        return await self.runtime.command(SimpleNamespace(context=SimpleNamespace(user_id="admin"), data={"operation": operation, "payload": payload, "revision": self.runtime.data["revision"] if revision is None else revision}))

    def add_entity(self, index):
        self.hass.entities[f"climate.room_{index}"] = SimpleNamespace(state="heat", attributes={"temperature": 19, "current_temperature": 18, "hvac_action": "heating", "min_temp": 5, "max_temp": 30})

    async def drain(self):
        if self.runtime.tasks:
            await asyncio.wait_for(asyncio.gather(*list(self.runtime.tasks.values())), timeout=3)
        await asyncio.sleep(0)

    async def test_add_eight_then_twenty_same_registry_controls_all(self):
        await self.command("settings", {"relay": "switch.boiler", "confirm_seconds": 0, "minimum_off": 0})
        for i in range(20):
            self.add_entity(i)
            await self.command("save_room", {"entity": f"climate.room_{i}", "name": f"Room {i}", "mode": "confort"})
            self.assertEqual(len(self.runtime.data["rooms"]), i+1)
        await self.command("settings", {"enabled": True})
        await self.drain()
        self.assertEqual(len(self.runtime.status["rooms"]), 20)
        self.assertEqual(self.runtime.status["heating_count"], 20)
        self.assertEqual(self.hass.entities["switch.boiler"].state, "on")
        for i in range(20):
            self.assertEqual(self.hass.entities[f"climate.room_{i}"].attributes["temperature"], 20)
        for r in list(self.runtime.data["rooms"]):
            await self.command("remove_room", {"id": r["id"]})
        self.assertEqual(self.runtime.status["rooms"], [])
        self.assertEqual(self.hass.entities["switch.boiler"].state, "off")

    async def test_admin_revision_and_storage_guards(self):
        self.add_entity(0)
        before = deepcopy(self.runtime.data)
        self.hass.admin = False
        with self.assertRaises(ServiceValidationError):
            await self.command("save_room", {"entity": "climate.room_0", "name": "Room"})
        self.hass.admin = True
        with self.assertRaises(ServiceValidationError):
            await self.command("retry", {}, revision=123)
        self.runtime.store.fail = True
        with self.assertRaises(OSError):
            await self.command("save_room", {"entity": "climate.room_0", "name": "Room"})
        self.assertEqual(self.runtime.data, before)
        self.assertEqual(self.hass.calls, [])

    async def test_restart_restores_room_profiles_and_override(self):
        self.add_entity(0)
        await self.command("settings", {"relay": "switch.boiler"})
        await self.command("save_room", {"entity": "climate.room_0", "name": "Bedroom", "mode": "planning"})
        await self.command("settings", {"enabled": True})
        key = self.runtime.data["rooms"][0]["id"]
        await self.command("override", {"id": key, "temperature": 22, "hours": 3})
        await self.drain()
        restarted = adapter.HeatingRuntime(self.hass, "test")
        restarted.store.value = deepcopy(self.runtime.store.value)
        await restarted.load()
        self.assertEqual(restarted.data, self.runtime.data)
        self.assertTrue(restarted.reset)

    async def test_stop_and_remove_work_even_when_entity_deleted(self):
        self.add_entity(0)
        await self.command("settings", {"relay": "switch.boiler"})
        await self.command("save_room", {"entity": "climate.room_0", "name": "Room"})
        await self.command("settings", {"enabled": True})
        del self.hass.entities["climate.room_0"]
        await self.command("settings", {"enabled": False})
        await self.command("remove_room", {"id": self.runtime.data["rooms"][0]["id"]})
        self.assertFalse(self.runtime.data["settings"]["enabled"])

    async def test_failed_setpoint_excluded_from_demand(self):
        self.add_entity(0)
        await self.command("settings", {"relay": "switch.boiler", "minimum_off": 0, "confirm_seconds": 0})
        await self.command("save_room", {"entity": "climate.room_0", "name": "Room", "mode": "confort"})
        self.hass.fail_climate = True
        await self.command("settings", {"enabled": True})
        await self.drain()
        await self.runtime.tick()
        self.assertEqual(self.runtime.status["heating_count"], 0)
        self.assertEqual(self.hass.entities["switch.boiler"].state, "off")

    async def test_storage_failure_requests_off_without_sending_on(self):
        self.add_entity(0)
        await self.command("settings", {"relay": "switch.boiler"})
        await self.command("save_room", {"entity": "climate.room_0", "name": "Room", "mode": "confort"})
        await self.command("settings", {"enabled": True})
        await self.drain()
        self.hass.entities["switch.boiler"].state = "on"
        self.runtime.store.fail = True
        self.runtime.reset = True
        self.hass.calls.clear()
        await self.runtime.tick()
        self.assertEqual(self.hass.entities["switch.boiler"].state, "off")
        self.assertFalse(any(d == "switch" and a == "turn_on" for d, a, _ in self.hass.calls))
        self.assertTrue(self.runtime.status["faults"])

    async def test_master_stop_does_not_wait_for_slow_valve(self):
        self.add_entity(0)
        await self.command("settings", {"relay": "switch.boiler", "minimum_off": 0, "confirm_seconds": 0})
        await self.command("save_room", {"entity": "climate.room_0", "name": "Room", "mode": "confort"})
        entered = asyncio.Event()
        blocked = asyncio.Event()
        normal_call = self.hass.services.async_call
        async def slow_call(domain, action, data, blocking):
            if domain == "climate":
                entered.set()
                await blocked.wait()
            await normal_call(domain, action, data, blocking)
        self.hass.services.async_call = slow_call
        await self.command("settings", {"enabled": True})
        await asyncio.wait_for(entered.wait(), 1)
        self.assertEqual(self.hass.entities["switch.boiler"].state, "on")
        await asyncio.wait_for(self.command("settings", {"enabled": False}), 1)
        self.assertEqual(self.hass.entities["switch.boiler"].state, "off")


if __name__ == "__main__":
    unittest.main(verbosity=2)
