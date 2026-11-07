"""One house, configured in the dashboard rather than YAML."""
from homeassistant import config_entries
from homeassistant.core import callback
import voluptuous as vol

DOMAIN = "ma_maison_chauffage"


class HeatingConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="Ma maison - Chauffage", data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return HeatingOptionsFlow()


class HeatingOptionsFlow(config_entries.OptionsFlow):
    async def async_step_init(self, user_input=None):
        if user_input is not None:
            name = user_input["house_name"].strip() or "Ma maison"
            return self.async_create_entry(title="", data={"house_name": name})
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "house_name",
                        default=(
                            self.hass.data.get(DOMAIN).data["settings"]["house_name"]
                            if self.hass.data.get(DOMAIN)
                            else self.config_entry.options.get("house_name", "Ma maison")
                        ),
                    ): vol.All(str, vol.Length(max=80)),
                }
            ),
        )

