"""Load bundled cards without writing to the user's Lovelace resource collection."""
from pathlib import Path

from homeassistant.components.http import StaticPathConfig

BASE_URL = "/ma-maison-chauffage-assets"
MODULE_URL = f"{BASE_URL}/bootstrap.js"
DATA_KEY = "ma_maison_chauffage_frontend"


async def async_setup_frontend(hass):
    state = hass.data.setdefault(DATA_KEY, {"registered": False, "loaded": False})
    if not state["registered"]:
        await hass.http.async_register_static_paths([
            # Avoid the one-month cache header so a permanent Lovelace URL can serve updated modules.
            StaticPathConfig(BASE_URL, str(Path(__file__).parent / "assets"), False)
        ])
        state["registered"] = True
