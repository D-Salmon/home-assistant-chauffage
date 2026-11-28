"""Automatic, identity-based Zigbee2MQTT topic discovery."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "custom_components/ma_maison_chauffage/mqtt_topics.py"
spec = importlib.util.spec_from_file_location("chauffage_mqtt_topics", SOURCE)
topics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(topics)


class MqttTopicTests(unittest.TestCase):
    def test_climate_entity_follows_renamed_valve(self):
        entity = SimpleNamespace(platform="mqtt", unique_id="0x00158d00018255df_climate_zigbee2mqtt")
        device = SimpleNamespace(identifiers={("mqtt", "zigbee2mqtt_0x00158d00018255df")})
        payload = [{"ieee_address": "0x00158d00018255df", "friendly_name": "Vanne Valentine"}]
        bridges = {"zigbee2mqtt/bridge/devices": topics.bridge_devices(payload)}
        self.assertEqual(topics.discover_topic(entity, device, bridges), "zigbee2mqtt/Vanne Valentine")
        payload[0]["friendly_name"] = "Chambre Valentine"
        bridges["zigbee2mqtt/bridge/devices"] = topics.bridge_devices(payload)
        self.assertEqual(topics.discover_topic(entity, device, bridges), "zigbee2mqtt/Chambre Valentine")

    def test_unrelated_or_ambiguous_device_is_not_assigned(self):
        entity = SimpleNamespace(platform="mqtt", unique_id="0x00158d00018255df_climate_zigbee2mqtt")
        device = SimpleNamespace(identifiers={("mqtt", "zigbee2mqtt_0x00158d00018255df")})
        bridges = {"zigbee2mqtt/bridge/devices": {"0xaaaaaaaaaaaaaaaa": "Autre vanne"}}
        self.assertIsNone(topics.discover_topic(entity, device, bridges))
        bridges = {"zigbee2mqtt/bridge/devices": {"0x00158d00018255df": "Vanne"},
                   "autre/bridge/devices": {"0x00158d00018255df": "Vanne"}}
        self.assertIsNone(topics.discover_topic(entity, device, bridges))
        entity.platform = "template"
        self.assertIsNone(topics.discover_topic(entity, device, bridges))


if __name__ == "__main__":
    unittest.main()

