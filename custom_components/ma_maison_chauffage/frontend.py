"""Register the bundled cards and keep their Lovelace resource cache-safe."""
import json
import logging
from pathlib import Path
from urllib.parse import urlsplit

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace import LOVELACE_DATA, MODE_STORAGE

BASE_URL = "/ma-maison-chauffage-assets"
MODULE_URL = f"{BASE_URL}/bootstrap-v3.js"
DATA_KEY = "ma_maison_chauffage_frontend"
_LOGGER = logging.getLogger(__name__)
_ASSETS = Path(__file__).parent / "assets"
_VERSION = json.loads((Path(__file__).parent / "manifest.json").read_text(encoding="utf-8"))["version"]
RESOURCE_URL = f"{MODULE_URL}?v={_VERSION}"
_MANAGED_PATHS = {MODULE_URL, f"{BASE_URL}/bootstrap.js"}
_LEGACY_PATHS = {f"{BASE_URL}/ma-maison-chauffage-card.js", "/local/ma-maison-chauffage-card.js"}


async def async_sync_resource(hass):
    """Update only our resource; leave other dashboard resources untouched."""
    lovelace = hass.data.get(LOVELACE_DATA)
    if lovelace is None or lovelace.resource_mode != MODE_STORAGE:
        _LOGGER.info("Lovelace resources are not in storage mode; configure %s manually", RESOURCE_URL)
        return
    resources = lovelace.resources
    # HA 2025.7 loads this collection lazily. Listing before loading can lose
    # existing resources when the first item is created.
    await resources.async_get_info()
    items = resources.async_items()
    managed = [item for item in items if urlsplit(item["url"]).path in _MANAGED_PATHS]
    if len(managed) > 1:
        _LOGGER.warning("Multiple Ma maison resources found; keep one and remove duplicates manually")
        return
    if managed:
        item = managed[0]
        if item["url"] != RESOURCE_URL or item["type"] != "module":
            await resources.async_update_item(item["id"], {"url": RESOURCE_URL, "res_type": "module"})
        return
    if any(urlsplit(item["url"]).path in _LEGACY_PATHS for item in items):
        _LOGGER.warning("Legacy Ma maison resource found; replace it with %s", RESOURCE_URL)
        return
    await resources.async_create_item({"url": RESOURCE_URL, "res_type": "module"})


async def async_setup_frontend(hass):
    state = hass.data.setdefault(DATA_KEY, {"registered": False})
    if not state["registered"]:
        await hass.http.async_register_static_paths([
            StaticPathConfig(BASE_URL, str(_ASSETS), False)
        ])
        state["registered"] = True
    try:
        await async_sync_resource(hass)
    except Exception:
        # Resource registration must not prevent the heating controller from starting.
        _LOGGER.exception("Could not update the Ma maison Lovelace resource")

