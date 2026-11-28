"""Schedule transitions used for heating and cooling anticipation."""
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "custom_components/ma_maison_chauffage/learning.py"
spec = importlib.util.spec_from_file_location("chauffage_learning_schedule", SOURCE)
learning = importlib.util.module_from_spec(spec)
spec.loader.exec_module(learning)


class LearningScheduleTests(unittest.TestCase):
    def test_custom_set_and_overnight_return_are_ordered(self):
        now = datetime(2026, 11, 23, 22, 0, tzinfo=timezone.utc)  # Monday
        blocks = {
            "monday": [{"from": "23:30:00", "to": "24:00:00", "data": {"profil": "set_children"}}],
            "tuesday": [{"from": "00:00:00", "to": "06:30:00", "data": {"profil": "set_children"}}],
        }
        transitions = learning.upcoming_blocks(blocks, now)
        self.assertEqual(transitions[:2], [
            (datetime(2026, 11, 23, 23, 30, tzinfo=timezone.utc).timestamp(), "set_children"),
            (datetime(2026, 11, 24, 0, 0, tzinfo=timezone.utc).timestamp(), "set_children"),
        ])
        self.assertEqual(transitions[2],
                         (datetime(2026, 11, 24, 6, 30, tzinfo=timezone.utc).timestamp(), "eco"))


if __name__ == "__main__":
    unittest.main()

