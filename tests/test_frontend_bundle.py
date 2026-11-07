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
