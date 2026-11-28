"""Resolve Zigbee2MQTT valve topics from Home Assistant device identity."""
import re


IEEE = re.compile(r"0x[0-9a-f]{16}")


def device_ieee(entity_entry, device_entry):
    """Use only an MQTT entity tied to a Zigbee2MQTT IEEE address."""
    if not entity_entry or entity_entry.platform != "mqtt":
        return None
    if device_entry:
        for domain, identifier in device_entry.identifiers:
            if domain == "mqtt" and isinstance(identifier, str):
                match = re.fullmatch(r"zigbee2mqtt_(0x[0-9a-f]{16})", identifier.lower())
                if match:
                    return match.group(1)
    unique_id = getattr(entity_entry, "unique_id", "") or ""
    match = re.fullmatch(r"(0x[0-9a-f]{16})_climate(?:_[a-z0-9_]+)?_zigbee2mqtt", unique_id.lower())
    return match.group(1) if match else None


def discover_topic(entity_entry, device_entry, bridges):
    """Return a topic only when exactly one bridge advertises this valve."""
    ieee = device_ieee(entity_entry, device_entry)
    if not ieee:
        return None
    matches = []
    for bridge_topic, devices in bridges.items():
        if not bridge_topic.endswith("/bridge/devices"):
            continue
        friendly_name = devices.get(ieee)
        if friendly_name and isinstance(friendly_name, str):
            base = bridge_topic[: -len("/bridge/devices")]
            matches.append(f"{base}/{friendly_name}")
    return matches[0] if len(matches) == 1 else None


def bridge_devices(payload):
    """Keep the stable IEEE-to-friendly-name mapping from a bridge message."""
    if not isinstance(payload, list):
        return None
    devices = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        ieee = item.get("ieee_address")
        name = item.get("friendly_name")
        if isinstance(ieee, str) and IEEE.fullmatch(ieee.lower()) and isinstance(name, str) and name and not name.startswith("bridge/"):
            devices[ieee.lower()] = name
    return devices

