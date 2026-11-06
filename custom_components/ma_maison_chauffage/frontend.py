"""Load bundled cards without writing to the user's Lovelace resource collection."""
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url, remove_extra_js_url
from homeassistant.components.http import StaticPathConfig

VERSION = "3.1.0"
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
    if not state["loaded"]:
        add_extra_js_url(hass, MODULE_URL)
        state["loaded"] = True


def async_unload_frontend(hass):
    state = hass.data.get(DATA_KEY)
    if state and state["loaded"]:
        remove_extra_js_url(hass, MODULE_URL)
        state["loaded"] = False
