const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const registry = new Map();
class HTMLElement {
  attachShadow() {
    this.shadowRoot = {innerHTML: '', querySelector: () => null, querySelectorAll: () => []};
    return this.shadowRoot;
  }
}
vm.runInNewContext(fs.readFileSync('www/ma-maison-chauffage-card.js', 'utf8'), {
  HTMLElement, window: {customCards: []}, customElements: {
    get: name => registry.get(name), define: (name, value) => registry.set(name, value)
  }
});
const card = new (registry.get('ma-maison-chauffage-card'))();
card.setConfig({type: 'custom:ma-maison-chauffage-card'});
const configuration = {revision: 0, rooms: [], settings: {
  enabled: false, absent: false, relay: '', schedules: [], active_schedule: '',
  outdoor_sensor: '', house_name: 'Ma maison'
}};
const registryState = {entity_id: 'sensor.registry', attributes: {
  integration: 'ma_maison_chauffage', configuration, status: {relay: 'off', rooms: [], faults: []}
}};
const hass = {
  states: {'sensor.registry': registryState, 'sensor.outdoor': {state: '8.5'}},
  async callService() {},
  async callWS() { return Object.values(this.states); }
};
card.hass = hass;
async function run() {
  assert.doesNotMatch(card.shadowRoot.innerHTML, /class="outdoor-tile"/);
  await card.command('settings', {outdoor_sensor: 'sensor.outdoor', house_name: 'Saint Léger'}, 0, 'home');
  assert.match(card.shadowRoot.innerHTML, /class="outdoor-tile"/);
  assert.match(card.shadowRoot.innerHTML, /Saint Léger/);
  card.hass = hass; // HA can send one more copy of the old registry state.
  assert.match(card.shadowRoot.innerHTML, /class="outdoor-tile"/);
  registryState.attributes.configuration = {...configuration, revision: 1,
    settings: {...configuration.settings, outdoor_sensor: 'sensor.outdoor', house_name: 'Saint Léger'}};
  card.hass = hass;
  assert.equal(card.pendingSettings, null);
  assert.match(card.shadowRoot.innerHTML, /class="outdoor-tile"/);
  console.log('settings refresh OK');
}
run().catch(error => {console.error(error); process.exitCode = 1;});

