const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const registry = new Map();
class HTMLElement {
  attachShadow() { this.shadowRoot = {}; return this.shadowRoot; }
  dispatchEvent(event) { this.events.push(event); return true; }
}
class CustomEvent {
  constructor(type, options) { this.type = type; Object.assign(this, options); }
}
vm.runInNewContext(fs.readFileSync('configuration/chauffage-planning-card.js', 'utf8'), {
  HTMLElement, CustomEvent, customElements: {
    get: name => registry.get(name), define: (name, value) => registry.set(name, value),
  },
});

const card = new (registry.get('chauffage-planning-card'))();
card.events = [];
card.render = () => {};
card.setConfig({schedules: [{entity: 'schedule.classique'}], rooms: [
  {id: 'enfant', temperatures: {eco: 17}},
  {id: 'salon', temperatures: {eco: 18}},
], temperature_sets: {}, revision: 4});
const calls = [];
card._hass = {callService: async (...args) => calls.push(args)};
card.setDraft.name = "Pas d'enfants";
card.setDraft.temperatures.enfant = 17;
card.setDraft.temperatures.salon = 21;

(async () => {
  await card.saveSet();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].operation, 'save_temperature_set');
  assert.equal(calls[0][2].payload.temperatures.enfant, 17);
  assert.equal(calls[0][2].payload.temperatures.salon, 21);
  assert.equal(card.events[0].type, 'chauffage-temperature-set-saved');
  console.log('temperature set card save OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
