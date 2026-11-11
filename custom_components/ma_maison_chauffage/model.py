"""Pure, testable configuration and heating decisions; no HA imports."""
from copy import deepcopy
import math
import re
import uuid

PROFILES = ("confort", "eco", "nuit", "absent")
DEFAULT_TEMPS = dict(confort=20.0, eco=17.0, nuit=17.0, absent=14.0)


def initial_data():
    return {"revision": 0, "rooms": [], "settings": {
        "enabled": False, "absent": False, "relay": "", "schedules": [], "house_name": "Ma maison",
        "active_schedule": "", "temperature_sets": {}, "confirm_seconds": 30, "stop_seconds": 30,
        "minimum_off": 180, "freshness_minutes": 120,
        "anticipation_enabled": True, "anticipation_window_days": 14, "outdoor_sensor": "",
    }}


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Valeur numérique attendue.")
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"Valeur attendue entre {low} et {high}.")
    return value


def temperature(value):
    number(value, 5, 25)
    if value * 2 != round(value * 2):
        raise ValueError("La température se règle par pas de 0,5 °C.")
    return float(value)


def valve_override_temperature(room, settings, value, recently_sent, now):
    """Accept a physical setpoint as a new temporary override."""
    override = room.get("override")
    if not settings["enabled"] or settings["absent"]:
        return None
    try:
        selected = temperature(float(value))
    except (TypeError, ValueError):
        return None
    if (override and override["until"] > now and selected == override["temperature"]) or selected in recently_sent:
        return None
    return selected


def entity_id(value, domain, optional=False):
    if optional and value == "":
        return value
    if not isinstance(value, str) or not re.fullmatch(domain + r"\.[a-z0-9_]+", value):
        raise ValueError(f"Choisissez une entité {domain} valide.")
    return value


def label(value):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 80:
        raise ValueError("Le nom doit contenir entre 1 et 80 caractères.")
    return value.strip()


def change(data, operation, payload, now):
    """Validate a complete transaction before exposing or persisting any changes."""
    new = deepcopy(data)
    if not isinstance(payload, dict):
        raise ValueError("Données invalides.")
    rooms, settings = new["rooms"], new["settings"]
    if operation == "save_room":
        allowed = {"id", "name", "entity", "temperatures", "mode", "last_seen", "pause_entity", "resume_override"}
        if set(payload) - allowed:
            raise ValueError("Champ de pièce inconnu.")
        resume_override = payload.get("resume_override", False)
        if not isinstance(resume_override, bool):
            raise ValueError("Valeur oui/non attendue.")
        old = next((r for r in rooms if r["id"] == payload.get("id")), None)
        if "id" in payload and old is None:
            raise ValueError("La pièce n’existe plus. Rechargez la page.")
        room = deepcopy(old) if old else {"id": uuid.uuid4().hex, "mode": "planning", "override": None, "last_seen": "", "pause_entity": "", "temperatures": deepcopy(DEFAULT_TEMPS)}
        room.update({key: value for key, value in payload.items() if key != "resume_override"})
        room["name"] = label(room.get("name"))
        room["entity"] = entity_id(room.get("entity"), "climate")
        room["last_seen"] = entity_id(room["last_seen"], "sensor", optional=True)
        pause_entity = room.get("pause_entity", "")
        if pause_entity and (not isinstance(pause_entity, str) or not re.fullmatch(r"(?:binary_sensor|input_boolean|switch)\.[a-z0-9_]+", pause_entity)):
            raise ValueError("Choisissez une entité de fenêtre ou un interrupteur.")
        room["pause_entity"] = pause_entity
        if any(r["entity"] == room["entity"] and r["id"] != room["id"] for r in rooms):
            raise ValueError("Cette vanne est déjà utilisée par une autre pièce.")
        if room["mode"] not in ("planning", *PROFILES):
            raise ValueError("Mode de pièce inconnu.")
        if not isinstance(room["temperatures"], dict) or set(room["temperatures"]) != set(PROFILES):
            raise ValueError("Renseignez les quatre températures.")
        room["temperatures"] = {p: temperature(room["temperatures"][p]) for p in PROFILES}
        if old and (resume_override or old["mode"] != room["mode"] or old["entity"] != room["entity"]):
            room["override"] = None
        if old:
            rooms[rooms.index(old)] = room
        else:
            rooms.append(room)
    elif operation in ("remove_room", "override", "resume"):
        room = next((r for r in rooms if r["id"] == payload.get("id")), None)
        if room is None:
            raise ValueError("Pièce introuvable.")
        if operation == "remove_room":
            rooms.remove(room)
            for item in settings.get("temperature_sets", {}).values():
                item["temperatures"].pop(room["id"], None)
        elif operation == "resume":
            mode = payload.get("mode", room["mode"])
            if mode not in ("planning", *PROFILES):
                raise ValueError("Mode de pièce inconnu.")
            room["mode"] = mode
            room["override"] = None
        else:
            if not settings["enabled"] or settings["absent"]:
                raise ValueError("Activez le chauffage et quittez l’absence maison.")
            room["override"] = {"temperature": temperature(payload.get("temperature")),
                                "until": now + number(payload.get("hours"), .5, 12) * 3600}
    elif operation == "save_temperature_set":
        if set(payload) != {"id", "name", "temperatures"}:
            raise ValueError("Jeu de températures invalide.")
        set_id = payload["id"]
        if set_id is not None and (not isinstance(set_id, str) or not re.fullmatch(r"set_[a-f0-9]{32}", set_id) or set_id not in settings.get("temperature_sets", {})):
            raise ValueError("Jeu de températures introuvable.")
        values = payload["temperatures"]
        if not isinstance(values, dict) or set(values) != {room["id"] for room in rooms}:
            raise ValueError("Renseignez la température de chaque pièce.")
        set_id = set_id or "set_" + uuid.uuid4().hex
        name = label(payload["name"])
        names = {"confort", "éco", "eco", "nuit", "absent"}
        names.update(item["name"].casefold() for key, item in settings.get("temperature_sets", {}).items() if key != set_id)
        if name.casefold() in names:
            raise ValueError("Ce nom de jeu est déjà utilisé.")
        settings.setdefault("temperature_sets", {})[set_id] = {"name": name,
                                                               "temperatures": {room_id: temperature(value) for room_id, value in values.items()}}
    elif operation == "remove_temperature_set":
        if set(payload) != {"id"} or payload["id"] not in settings.get("temperature_sets", {}):
            raise ValueError("Jeu de températures introuvable.")
        del settings["temperature_sets"][payload["id"]]
    elif operation == "settings":
        if set(payload) - set(settings) or "temperature_sets" in payload:
            raise ValueError("Réglage inconnu.")
        previous = deepcopy(settings)
        settings.update(payload)
        settings["house_name"] = label(settings["house_name"])
        for key in ("enabled", "absent", "anticipation_enabled"):
            if not isinstance(settings[key], bool):
                raise ValueError("Valeur oui/non attendue.")
        entity_id(settings["relay"], "switch", optional=not settings["enabled"])
        entity_id(settings["outdoor_sensor"], "sensor", optional=True)
        for key, maximum in [("confirm_seconds", 600), ("stop_seconds", 300), ("minimum_off", 1800), ("freshness_minutes", 1500)]:
            number(settings[key], 0 if key != "freshness_minutes" else 5, maximum)
        if settings["anticipation_window_days"] not in (7, 14):
            raise ValueError("La période d’apprentissage doit être de 7 ou 14 jours.")
        if not isinstance(settings["schedules"], list):
            raise ValueError("Liste de plannings attendue.")
        seen = set()
        for s in settings["schedules"]:
            if not isinstance(s, dict) or set(s) != {"name", "entity"}:
                raise ValueError("Planning invalide.")
            s["name"] = label(s["name"])
            entity_id(s["entity"], "schedule")
            if s["entity"] in seen:
                raise ValueError("Un planning figure deux fois dans la liste.")
            seen.add(s["entity"])
        if settings["active_schedule"] and settings["active_schedule"] not in seen:
            raise ValueError("Le planning actif doit appartenir à la liste.")
        if previous["absent"] != settings["absent"]:
            for room in rooms:
                room["override"] = None
        elif previous["active_schedule"] != settings["active_schedule"]:
            for room in rooms:
                if room["mode"] == "planning":
                    room["override"] = None
    elif operation == "retry":
        pass
    else:
        raise ValueError("Action inconnue.")
    new["revision"] += 1
    return new


def target(room, settings, schedule, now):
    """Return desired temperature and its explanation, or a fault."""
    if not settings["enabled"]:
        return None, "arrêt"
    if settings["absent"]:
        profile = "absent"
    elif room.get("override") and room["override"]["until"] > now:
        return room["override"]["temperature"], "manuel"
    elif room["mode"] != "planning":
        profile = room["mode"]
    elif schedule and schedule["state"] in ("on", "off"):
        profile = (schedule.get("attributes", {}).get("profil") or "confort") if schedule["state"] == "on" else "eco"
    else:
        return None, "planning indisponible"
    if profile in PROFILES:
        return room["temperatures"][profile], profile
    custom = settings.get("temperature_sets", {}).get(profile)
    if custom:
        return custom.get("temperatures", {}).get(room["id"], room["temperatures"]["eco"]), custom["name"]
    return None, "profil invalide"


def supported_temperature(attributes, value):
    """Reject malformed or inconsistent device limits rather than losing a control tick."""
    low, high = attributes.get("min_temp", 5), attributes.get("max_temp", 25)
    try:
        number(low, -100, 100)
        number(high, -100, 100)
        return low <= value <= high
    except (ValueError, TypeError):
        return False


def decide(settings, count, heating, faults, actual, old, now, reset=False):
    """Relay anti-cycling and bounded retries, independent of room count."""
    wanted = settings["enabled"] and bool(heating)
    force_off = not settings["enabled"] or count == 0 or (not heating and bool(faults))
    since = now if reset or old.get("wanted") != wanted else min(now, old.get("since", now))
    off_since = now if actual != "on" and (reset or old.get("actual") != actual) else min(now, old.get("off_since", now))
    if force_off or actual not in ("on", "off"):
        desired = "off"
    elif wanted:
        desired = "on" if actual == "on" or (now - since >= settings["confirm_seconds"] and now - off_since >= settings["minimum_off"]) else "off"
    else:
        desired = "off" if now - since >= settings["stop_seconds"] else actual
    attempts = 0 if reset or actual == desired or old.get("desired") != desired or (old.get("actual") not in ("on", "off") and actual in ("on", "off")) else old.get("attempts", 0)
    last = old.get("last_attempt", 0)
    send = actual != desired and attempts < 3 and (reset or old.get("desired") != desired or now - last >= 15)
    return {"wanted": wanted, "since": since, "off_since": off_since, "actual": actual,
            "desired": desired, "attempts": attempts + int(send),
            "last_attempt": now if send else last}, send
