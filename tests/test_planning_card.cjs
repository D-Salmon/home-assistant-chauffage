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

const Card = registry.get('chauffage-planning-card');
const selected = new Card();
selected.render = () => {};
selected.setConfig({schedules:[{entity:'schedule.classique'},{entity:'schedule.weekend'}],active_schedule:'schedule.weekend'});
assert.equal(selected.index, 1);
const original = {id:'weekday',monday:[{from:'07:00',to:'08:00',data:{profil:'confort'}}]};
const card = new Card();
card.events = [];
card.render = () => {};
card.original = structuredClone(original);
card.draft = structuredClone(original);
card.dirty = true;
card._hass = {callWS: async message => message.type === 'schedule/list'
  ? [structuredClone(original)] : {id:'weekday',...message}};

(async () => {
  await card.save();
  assert.equal(card.dirty, false);
  assert.equal(card.events.length, 1);
  assert.equal(card.events[0].type, 'chauffage-planning-saved');
  assert.equal(card.events[0].bubbles, true);
  assert.equal(card.events[0].composed, true);

  card.events = [];
  card.draft.monday[0].to = '06:00';
  card.dirty = true;
  await card.save();
  assert.equal(card.events.length, 0);
  assert.equal(card.dirty, true);
  console.log('planning save navigation signal OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
