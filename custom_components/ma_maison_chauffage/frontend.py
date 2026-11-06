"""Load bundled cards without writing to the user's Lovelace resource collection."""
from pathlib import Path

from homeassistant.components.http import StaticPathConfig

VERSION = "3.1.2"
BASE_URL = "/ma-maison-chauffage-assets"
MODULE_URL = f"{BASE_URL}/bootstrap.js?v={VERSION}"
DATA_KEY = "ma_maison_chauffage_frontend"


async def async_setup_frontend(hass):
    state = hass.data.setdefault(DATA_KEY, {"registered": False, "loaded": False})
    if not state["registered"]:
        await hass.http.async_register_static_paths([
            StaticPathConfig(BASE_URL, str(Path(__file__).parent / "assets"), True)
        ])
        state["registered"] = True
