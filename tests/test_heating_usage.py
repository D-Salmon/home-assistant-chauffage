"""Relay run time stays in the correct local calendar period."""

from datetime import datetime, timezone
from pathlib import Path
import importlib.util
import unittest
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


path = Path(__file__).resolve().parents[1] / "custom_components/ma_maison_chauffage/usage.py"
spec = importlib.util.spec_from_file_location("heating_usage", path)
usage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usage)


class HeatingUsageTests(unittest.TestCase):
    def setUp(self):
        self.zone = timezone.utc

    def timestamp(self, year, month, day, hour, minute=0):
        return datetime(year, month, day, hour, minute, tzinfo=self.zone).timestamp()

    def test_month_and_year_boundary(self):
        days = {}
        usage.add_interval(days, self.timestamp(2026, 12, 31, 23, 30), self.timestamp(2027, 1, 1, 0, 30), self.zone)
        self.assertEqual(days, {"2026-12-31": 1800, "2027-01-01": 1800})

    def test_summer_time_change_uses_real_elapsed_seconds(self):
        try:
            self.zone = ZoneInfo("Europe/Paris")
        except ZoneInfoNotFoundError:
            self.skipTest("Time-zone data is unavailable on this Windows Python installation")
        days = {}
        usage.add_interval(days, self.timestamp(2026, 3, 29, 1), self.timestamp(2026, 3, 29, 4), self.zone)
        self.assertEqual(days, {"2026-03-29": 7200})

    def test_transition_only_credits_actual_on_time(self):
        days = {}
        start = self.timestamp(2026, 11, 12, 10)
        usage.advance(days, start, "off", start + 30, "on", start + 12, self.zone)
        usage.advance(days, start + 30, "on", start + 60, "off", start + 45, self.zone)
        self.assertEqual(days, {"2026-11-12": 33})

    def test_first_observation_does_not_count_downtime(self):
        days = {}
        now = self.timestamp(2026, 11, 12, 10)
        self.assertEqual(usage.advance(days, None, None, now, "on", now - 3600, self.zone), 0)
        self.assertEqual(days, {})


if __name__ == "__main__":
    unittest.main()
