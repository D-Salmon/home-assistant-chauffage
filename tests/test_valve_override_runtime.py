"""A physical valve change updates an active temporary setpoint."""
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch


def stub(name, **members):
    module = ModuleType(name)
    module.__dict__.update(members)
    sys.modules[name] = module


stub("homeassistant")
stub("homeassistant.const", EVENT_HOMEASSISTANT_STARTED="start", EVENT_HOMEASSISTANT_STOP="stop", EVENT_STATE_CHANGED="state_changed")
stub("homeassistant.core", callback=lambda fn: fn)
stub("homeassistant.exceptions", ServiceValidationError=ValueError)
stub("homeassistant.helpers")
stub("homeassistant.helpers.dispatcher", async_dispatcher_send=lambda *_: None)
stub("homeassistant.helpers.event", async_track_time_interval=lambda *_: None)
stub("homeassistant.helpers.storage", Store=object)
stub("homeassistant.util")
stub("homeassistant.util.dt", now=lambda: None)

package = "valve_runtime_test_package"
component = Path(__file__).resolve().parents[1] / "custom_components/ma_maison_chauffage"
stub(package + ".learning", add_sample=lambda *_: None, estimate_minutes=lambda *_: None, upcoming_block=lambda *_: None)
spec = importlib.util.spec_from_file_location(package, component / "__init__.py", submodule_search_locations=[str(component)])
runtime_module = importlib.util.module_from_spec(spec)
sys.modules[package] = runtime_module
spec.loader.exec_module(runtime_module)


class ImmediateLock:
    def locked(self):
        return False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False


def complete(coroutine):
    try:
        coroutine.send(None)
    except StopIteration:
        return
    raise AssertionError("The test coroutine unexpectedly paused")


class ValveOverrideRuntimeTests(unittest.TestCase):
    def setUp(self):
        data = runtime_module.initial_data()
        data["settings"].update(enabled=True, relay="switch.boiler")
        data = runtime_module.change(data, "save_room", {
            "name": "Chambre", "entity": "climate.chambre", "mode": "planning",
            "temperatures": {"confort": 20, "eco": 17, "nuit": 17, "absent": 14},
        }, 1000)
        self.room_id = data["rooms"][0]["id"]
        self.runtime = runtime_module.HeatingRuntime.__new__(runtime_module.HeatingRuntime)
        self.runtime.data = runtime_module.change(data, "override", {
            "id": self.room_id, "temperature": 20, "hours": 3,
        }, 1000)
        self.runtime.lock = ImmediateLock()
        self.runtime.started = True
        self.runtime.sent_setpoints = {self.room_id: [(20, 1000)]}
        self.runtime.tasks = {}
        self.runtime.retry_after = {}
        self.runtime.command_errors = {}
        self.runtime.reset = False
        self.runtime.memory = {}
        self.runtime.learning = {}
        self.runtime.store = SimpleNamespace(async_save=AsyncMock())
        self.runtime.publish = Mock()
        self.runtime.tick = AsyncMock()
        self.created = []
        self.runtime.hass = SimpleNamespace(async_create_task=self._create_task)

    def _create_task(self, coroutine):
        self.created.append(coroutine)
        return coroutine

    def test_heating_usage_summary_is_monthly(self):
        self.runtime.usage = {"days": {"2026-10-31": 60, "2026-11-01": 120, "2026-11-02": 30}, "reset_at": None}
        self.assertEqual(self.runtime.usage_summary(), {"months": {"2026-10": 60, "2026-11": 150}, "reset_at": None})

    def test_new_valve_setpoint_resets_temporary_duration_and_refreshes_card(self):
        old = SimpleNamespace(state="heat", attributes={"temperature": 20})
        new = SimpleNamespace(state="heat", attributes={"temperature": 22})
        event = SimpleNamespace(data={"entity_id": "climate.chambre", "old_state": old, "new_state": new})
        with patch.object(runtime_module.time, "time", return_value=1100):
            self.runtime.state_changed(event)
            for coroutine in self.created:
                complete(coroutine)
        self.assertEqual(self.runtime.data["rooms"][0]["override"], {"temperature": 22.0, "until": 11900})
        self.runtime.store.async_save.assert_awaited_once()
        self.runtime.publish.assert_called_once()
        self.runtime.tick.assert_awaited_once()

    def test_valve_setpoint_starts_override_when_none_is_active(self):
        self.runtime.data["rooms"][0]["override"] = None
        self.runtime.sent_setpoints[self.room_id] = [(10, 1000)]
        old = SimpleNamespace(state="heat", attributes={"temperature": 10})
        new = SimpleNamespace(state="heat", attributes={"temperature": 11.5})
        event = SimpleNamespace(data={"entity_id": "climate.chambre", "old_state": old, "new_state": new})
        with patch.object(runtime_module.time, "time", return_value=1100):
            self.runtime.state_changed(event)
            for coroutine in self.created:
                complete(coroutine)
        self.assertEqual(self.runtime.data["rooms"][0]["override"], {"temperature": 11.5, "until": 11900})
        self.runtime.publish.assert_called_once()
        self.runtime.tick.assert_awaited_once()

    def test_own_setpoint_acknowledgment_keeps_previous_override(self):
        old = SimpleNamespace(state="heat", attributes={"temperature": 19})
        new = SimpleNamespace(state="heat", attributes={"temperature": 20})
        event = SimpleNamespace(data={"entity_id": "climate.chambre", "old_state": old, "new_state": new})
        with patch.object(runtime_module.time, "time", return_value=1100):
            self.runtime.state_changed(event)
            for coroutine in self.created:
                complete(coroutine)
        self.assertEqual(self.runtime.data["rooms"][0]["override"], {"temperature": 20.0, "until": 11800})
        self.runtime.store.async_save.assert_not_awaited()
        self.runtime.tick.assert_awaited_once()

    def test_return_to_planning_ignores_late_old_setpoint(self):
        self.runtime.sent_setpoints[self.room_id] = []
        self.runtime.hass.auth = SimpleNamespace(async_get_user=AsyncMock(return_value=SimpleNamespace(is_admin=True)))
        call = SimpleNamespace(context=SimpleNamespace(user_id="admin"), data={
            "revision": self.runtime.data["revision"], "operation": "resume",
            "payload": {"id": self.room_id, "mode": "planning"},
        })
        with patch.object(runtime_module.time, "time", return_value=1100):
            complete(self.runtime.command(call))
        self.assertIsNone(self.runtime.data["rooms"][0]["override"])
        self.assertEqual(self.runtime.sent_setpoints[self.room_id], [(20.0, 1100)])
        with patch.object(runtime_module.time, "time", return_value=1101):
            complete(self.runtime.adopt_valve_setpoint(self.room_id, 20))
        self.assertIsNone(self.runtime.data["rooms"][0]["override"])
        self.runtime.store.async_save.assert_awaited_once()

    def test_planning_preview_does_not_interrupt_active_override(self):
        self.runtime.data["settings"].update(active_schedule="schedule.week", anticipation_enabled=True)
        self.runtime.schedule_data = {}
        self.runtime.schedule_data_at = 1100
        self.runtime.last_notice = ""
        self.runtime.status = {}
        self.runtime.persist = AsyncMock()
        self.runtime.service = AsyncMock()
        self.runtime.snapshot = lambda entity: {
            "schedule.week": {"state": "on", "attributes": {"profil": "confort"}},
            "climate.chambre": {"state": "heat", "attributes": {"temperature": 20, "hvac_action": "idle"}},
            "switch.boiler": {"state": "off", "attributes": {}},
        }.get(entity)
        with patch.object(runtime_module.time, "time", return_value=1100), patch.object(
            runtime_module, "estimate_minutes", return_value=(30, 0)
        ):
            complete(self.runtime.control_tick())
        room = self.runtime.status["rooms"][0]
        self.assertEqual((room["target"], room["profile"]), (20.0, "manuel"))
        self.assertEqual((room["planning_target"], room["planning_profile"]), (20.0, "confort"))
        self.assertEqual(self.runtime.status["faults"], [])
        self.runtime.data["rooms"][0]["override"] = None
        with patch.object(runtime_module.time, "time", return_value=1101), patch.object(
            runtime_module, "estimate_minutes", return_value=(30, 0)
        ):
            complete(self.runtime.control_tick())
        self.assertEqual((self.runtime.status["rooms"][0]["target"], self.runtime.status["rooms"][0]["profile"]),
                         (20.0, "confort"))
        self.assertEqual(self.runtime.status["faults"], [])


if __name__ == "__main__":
    unittest.main()
