"""Bundling and frontend registration checks without an HA installation."""
import importlib.util
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components/ma_maison_chauffage"


def stub(name, **members):
    module = ModuleType(name)
    module.__dict__.update(members)
    sys.modules[name] = module


stub("homeassistant")
stub("homeassistant.components")
stub("homeassistant.components.http", StaticPathConfig=lambda url, path, cache: (url, path, cache))
stub("homeassistant.components.lovelace", LOVELACE_DATA="lovelace", MODE_STORAGE="storage")
spec = importlib.util.spec_from_file_location("frontend_bundle", COMPONENT / "frontend.py")
frontend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frontend)


class BundleTests(unittest.TestCase):
    def test_packaged_sources_match(self):
        for source in (ROOT / "configuration/chauffage-planning-card.js", ROOT / "www/ma-maison-chauffage-card.js"):
            self.assertEqual(source.read_bytes(), (COMPONENT / "assets" / source.name).read_bytes(), "Run scripts/build_frontend.py")

    def test_version_and_hacs_structure(self):
        manifest = json.loads((COMPONENT / "manifest.json").read_text(encoding="utf-8"))
        for name in ("bootstrap.js", "bootstrap-v3.js"):
            bootstrap = (COMPONENT / "assets" / name).read_text(encoding="utf-8")
            self.assertEqual(bootstrap.count("?v=" + manifest["version"]), 2)
        self.assertTrue((ROOT / "hacs.json").exists())
        self.assertEqual([p.name for p in (ROOT / "custom_components").iterdir() if p.is_dir()], ["ma_maison_chauffage"])


class FakeResources:
    def __init__(self, items=()):
        self.stored = [dict(item) for item in items]
        self.items = []
        self.loaded = False
        self.updates = []
        self.created = []

    async def async_get_info(self):
        self.loaded = True
        self.items = self.stored
        return {"resources": len(self.items)}

    def async_items(self):
        return self.items

    async def async_update_item(self, item_id, updates):
        assert self.loaded
        self.updates.append((item_id, updates))
        item = next(item for item in self.items if item["id"] == item_id)
        item.update(url=updates["url"], type=updates["res_type"])
        return item

    async def async_create_item(self, data):
        assert self.loaded
        self.created.append(data)
        item = {"id": "new", "url": data["url"], "type": data["res_type"]}
        self.items.append(item)
        return item


class ResourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_updates_only_our_resource_and_is_idempotent(self):
        resources = FakeResources([
            {"id": "ours", "url": frontend.MODULE_URL + "?v=3.2.9", "type": "module"},
            {"id": "other", "url": "/other-card.js", "type": "module"},
        ])
        hass = SimpleNamespace(data={"lovelace": SimpleNamespace(resource_mode="storage", resources=resources)})
        await frontend.async_sync_resource(hass)
        await frontend.async_sync_resource(hass)
        self.assertEqual(resources.updates, [("ours", {"url": frontend.RESOURCE_URL, "res_type": "module"})])
        self.assertEqual(resources.items[1]["url"], "/other-card.js")
        self.assertFalse(resources.created)

    async def test_creates_only_after_loading_collection(self):
        resources = FakeResources()
        hass = SimpleNamespace(data={"lovelace": SimpleNamespace(resource_mode="storage", resources=resources)})
        await frontend.async_sync_resource(hass)
        self.assertEqual(resources.created, [{"url": frontend.RESOURCE_URL, "res_type": "module"}])

    async def test_yaml_and_legacy_resources_are_left_untouched(self):
        resources = FakeResources([{"id": "old", "url": "/local/ma-maison-chauffage-card.js", "type": "module"}])
        hass = SimpleNamespace(data={"lovelace": SimpleNamespace(resource_mode="storage", resources=resources)})
        await frontend.async_sync_resource(hass)
        self.assertFalse(resources.created)
        self.assertFalse(resources.updates)
        hass.data["lovelace"].resource_mode = "yaml"
        await frontend.async_sync_resource(hass)
        self.assertFalse(resources.created)


class RegistrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_static_assets_register_once(self):
        paths = []
        async def register(items):
            paths.extend(items)
        hass = SimpleNamespace(data={}, http=SimpleNamespace(async_register_static_paths=register))
        await frontend.async_setup_frontend(hass)
        await frontend.async_setup_frontend(hass)
        self.assertEqual(len(paths), 1)
        self.assertEqual(Path(paths[0][1]).resolve(), (COMPONENT / "assets").resolve())

    async def test_registration_failure_can_retry(self):
        async def fail(_items):
            raise RuntimeError("HTTP unavailable")
        hass = SimpleNamespace(data={}, urls=set(), http=SimpleNamespace(async_register_static_paths=fail))
        with self.assertRaises(RuntimeError):
            await frontend.async_setup_frontend(hass)
        self.assertFalse(hass.data[frontend.DATA_KEY]["registered"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

