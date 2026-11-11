"""One registry sensor, irrespective of the number of rooms."""
from copy import deepcopy
from homeassistant.components.sensor import SensorEntity
from homeassistant.core import callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([HeatingRegistry(hass.data[DOMAIN], entry.entry_id)])


class HeatingRegistry(SensorEntity):
    _attr_name = "Ma maison chauffage"
    _attr_icon = "mdi:home-thermometer-outline"
    _attr_should_poll = False
    _unrecorded_attributes = frozenset({"configuration", "status", "house_name"})

    def __init__(self, runtime, entry_id):
        self.runtime = runtime
        self._attr_unique_id = entry_id + "_registry"

    @property
    def native_value(self):
        return len(self.runtime.data["rooms"])

    @property
    def extra_state_attributes(self):
        return {"configuration": deepcopy(self.runtime.data), "status": deepcopy(self.runtime.status), "house_name": self.runtime.data["settings"]["house_name"], "version": "3.2.32", "integration": DOMAIN}

    async def async_added_to_hass(self):
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL, self.updated))

    @callback
    def updated(self):
        self.async_write_ha_state()
