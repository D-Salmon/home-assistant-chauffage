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


if __name__ == "__main__":
    unittest.main()
