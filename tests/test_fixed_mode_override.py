"""A temporary setpoint also works when a room uses a fixed profile."""
import importlib.util
from pathlib import Path
import unittest

MODEL = Path(__file__).resolve().parents[1] / "custom_components/ma_maison_chauffage/model.py"
spec = importlib.util.spec_from_file_location("chauffage_model", MODEL)
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)


class FixedModeOverrideTests(unittest.TestCase):
    def setUp(self):
        data = model.initial_data()
        data["settings"].update(enabled=True, relay="switch.boiler")
        self.data = model.change(data, "save_room", {
            "name": "Chambre", "entity": "climate.chambre", "mode": "confort",
            "temperatures": {"confort": 23, "eco": 17, "nuit": 17, "absent": 14},
        }, 1000)
        self.room_id = self.data["rooms"][0]["id"]

    def test_fixed_mode_returns_after_temporary_setpoint_expires(self):
        room = self.data["rooms"][0]
        self.assertEqual(model.target(room, self.data["settings"], None, 1000), (23.0, "confort"))
        changed = model.change(self.data, "override", {
            "id": self.room_id, "temperature": 20, "hours": 3,
        }, 1000)
        room = changed["rooms"][0]
        self.assertEqual(room["mode"], "confort")
        self.assertEqual(model.target(room, changed["settings"], None, 1001), (20.0, "manuel"))
        self.assertEqual(model.target(room, changed["settings"], None, 11801), (23.0, "confort"))

    def test_resume_keeps_the_original_mode(self):
        changed = model.change(self.data, "override", {
            "id": self.room_id, "temperature": 20, "hours": 3,
        }, 1000)
        resumed = model.change(changed, "resume", {"id": self.room_id}, 1100)
        room = resumed["rooms"][0]
        self.assertEqual(room["mode"], "confort")
        self.assertIsNone(room["override"])
        self.assertEqual(model.target(room, resumed["settings"], None, 1100), (23.0, "confort"))

    def test_resume_can_choose_another_mode(self):
        changed = model.change(self.data, "override", {
            "id": self.room_id, "temperature": 20, "hours": 3,
        }, 1000)
        resumed = model.change(changed, "resume", {"id": self.room_id, "mode": "eco"}, 1100)
        room = resumed["rooms"][0]
        self.assertEqual(room["mode"], "eco")
        self.assertIsNone(room["override"])
        self.assertEqual(model.target(room, resumed["settings"], None, 1100), (17.0, "eco"))

    def test_resume_rejects_unknown_mode(self):
        with self.assertRaisesRegex(ValueError, "Mode de pièce inconnu"):
            model.change(self.data, "resume", {"id": self.room_id, "mode": "invalid"}, 1100)

    def test_saving_planning_again_can_end_temporary_setpoint(self):
        planning = model.change(self.data, "save_room", {
            "id": self.room_id, "name": "Chambre", "entity": "climate.chambre",
            "mode": "planning", "temperatures": self.data["rooms"][0]["temperatures"],
        }, 1000)
        changed = model.change(planning, "override", {
            "id": self.room_id, "temperature": 20, "hours": 3,
        }, 1100)
        payload = {"id": self.room_id, "name": "Chambre", "entity": "climate.chambre",
                   "mode": "planning", "temperatures": changed["rooms"][0]["temperatures"]}
        unchanged = model.change(changed, "save_room", payload, 1200)
        self.assertIsNotNone(unchanged["rooms"][0]["override"])
        resumed = model.change(changed, "save_room", {**payload, "resume_override": True}, 1200)
        self.assertIsNone(resumed["rooms"][0]["override"])
        self.assertNotIn("resume_override", resumed["rooms"][0])
        self.assertEqual(model.target(resumed["rooms"][0], resumed["settings"],
                                      {"state": "on", "attributes": {"profil": "confort"}}, 1200),
                         (23.0, "confort"))

    def test_switching_from_eco_to_planning_uses_current_schedule_profile(self):
        eco = model.change(self.data, "save_room", {
            "id": self.room_id, "name": "Chambre", "entity": "climate.chambre",
            "mode": "eco", "temperatures": self.data["rooms"][0]["temperatures"],
        }, 1000)
        planning = model.change(eco, "save_room", {
            "id": self.room_id, "name": "Chambre", "entity": "climate.chambre",
            "mode": "planning", "temperatures": eco["rooms"][0]["temperatures"],
        }, 1100)
        self.assertEqual(planning["rooms"][0]["mode"], "planning")
        self.assertEqual(model.target(planning["rooms"][0], planning["settings"],
                                      {"state": "on", "attributes": {"profil": "confort"}}, 1100),
                         (23.0, "confort"))
        self.assertEqual(model.target(planning["rooms"][0], planning["settings"],
                                      {"state": "off", "attributes": {}}, 1100),
                         (17.0, "eco"))

    def test_return_to_planning_from_night_mode_uses_active_comfort_period(self):
        night = model.change(self.data, "save_room", {
            "id": self.room_id, "name": "Chambre", "entity": "climate.chambre",
            "mode": "nuit", "temperatures": self.data["rooms"][0]["temperatures"],
        }, 1000)
        resumed = model.change(night, "resume", {"id": self.room_id, "mode": "planning"}, 1100)
        self.assertEqual(resumed["rooms"][0]["mode"], "planning")
        self.assertEqual(model.target(resumed["rooms"][0], resumed["settings"],
                                      {"state": "on", "attributes": {"profil": "confort"}}, 1100),
                         (23.0, "confort"))

    def test_absence_blocks_temporary_setpoint(self):
        self.data["settings"]["absent"] = True
        with self.assertRaisesRegex(ValueError, "absence maison"):
            model.change(self.data, "override", {
                "id": self.room_id, "temperature": 20, "hours": 3,
            }, 1000)

    def test_schedule_change_preserves_fixed_mode_override(self):
        changed = model.change(self.data, "override", {
            "id": self.room_id, "temperature": 20, "hours": 3,
        }, 1000)
        changed["settings"]["schedules"] = [{"name": "Semaine", "entity": "schedule.semaine"}]
        changed = model.change(changed, "settings", {"active_schedule": "schedule.semaine"}, 1100)
        self.assertEqual(changed["rooms"][0]["override"]["temperature"], 20.0)

    def test_physical_valve_change_starts_new_three_hour_override(self):
        changed = model.change(self.data, "override", {
            "id": self.room_id, "temperature": 20, "hours": 3,
        }, 1000)
        room = changed["rooms"][0]
        selected = model.valve_override_temperature(room, changed["settings"], 22, {20}, 1100)
        self.assertEqual(selected, 22.0)
        adopted = model.change(changed, "override", {
            "id": self.room_id, "temperature": selected, "hours": 3,
        }, 1100)
        self.assertEqual(adopted["rooms"][0]["override"], {"temperature": 22.0, "until": 11900})

    def test_physical_valve_change_starts_override_without_previous_override(self):
        room = self.data["rooms"][0]
        selected = model.valve_override_temperature(room, self.data["settings"], 11.5, {10}, 1100)
        self.assertEqual(selected, 11.5)
        changed = model.change(self.data, "override", {
            "id": self.room_id, "temperature": selected, "hours": 3,
        }, 1100)
        self.assertEqual(changed["rooms"][0]["override"], {"temperature": 11.5, "until": 11900})

    def test_valve_acknowledgment_does_not_replace_override(self):
        changed = model.change(self.data, "override", {
            "id": self.room_id, "temperature": 23, "hours": 3,
        }, 1000)
        room = changed["rooms"][0]
        self.assertIsNone(model.valve_override_temperature(room, changed["settings"], 23, {23}, 1100))
        self.assertIsNone(model.valve_override_temperature(room, changed["settings"], 21, {21, 23}, 1100))
        self.assertIsNone(model.valve_override_temperature(room, changed["settings"], 22.3, set(), 1100))
        self.assertEqual(model.valve_override_temperature(room, changed["settings"], 22, set(), 11801), 22.0)


if __name__ == "__main__":
    unittest.main()
