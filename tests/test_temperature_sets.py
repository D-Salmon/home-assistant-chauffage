import unittest
import importlib.util
from pathlib import Path

MODEL = Path(__file__).resolve().parents[1] / "custom_components/ma_maison_chauffage/model.py"
spec = importlib.util.spec_from_file_location("chauffage_temperature_set_model", MODEL)
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)


class TemperatureSetTests(unittest.TestCase):
    def setUp(self):
        self.data = model.initial_data()
        self.data["settings"].update(enabled=True, schedules=[{"name": "Classique", "entity": "schedule.classique"}], active_schedule="schedule.classique")
        self.data = model.change(self.data, "save_room", {"name": "Chambre", "entity": "climate.chambre"}, 0)
        self.room = self.data["rooms"][0]

    def test_custom_set_drives_active_schedule_and_preserves_standard_profiles(self):
        room_id = self.room["id"]
        self.data = model.change(self.data, "save_temperature_set", {"id": None, "name": "Pas d'enfants", "temperatures": {room_id: 18}}, 0)
        set_id = next(iter(self.data["settings"]["temperature_sets"]))
        active = {"state": "on", "attributes": {"profil": set_id}}
        self.assertEqual(model.target(self.room, self.data["settings"], active, 0), (18.0, "Pas d'enfants"))
        standard = {"state": "on", "attributes": {"profil": "confort"}}
        self.assertEqual(model.target(self.room, self.data["settings"], standard, 0), (20.0, "confort"))
        self.assertEqual(model.target(self.room, self.data["settings"], {"state": "off"}, 0), (17.0, "eco"))

    def test_new_room_uses_eco_until_its_set_temperature_is_filled(self):
        room_id = self.room["id"]
        self.data = model.change(self.data, "save_temperature_set", {"id": None, "name": "Enfants absents", "temperatures": {room_id: 18}}, 0)
        set_id = next(iter(self.data["settings"]["temperature_sets"]))
        self.data = model.change(self.data, "save_room", {"name": "Salon", "entity": "climate.salon"}, 0)
        salon = self.data["rooms"][1]
        self.assertEqual(model.target(salon, self.data["settings"], {"state": "on", "attributes": {"profil": set_id}}, 0), (17.0, "Enfants absents"))

    def test_set_requires_every_existing_room(self):
        with self.assertRaisesRegex(ValueError, "chaque pièce"):
            model.change(self.data, "save_temperature_set", {"id": None, "name": "Incomplet", "temperatures": {}}, 0)


if __name__ == "__main__":
    unittest.main()
