const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const registry = new Map();
class HTMLElement {
  attachShadow() {
    this.shadowRoot = {
      innerHTML: '',
      querySelector: selector => this.shadowRoot.innerHTML.includes(`id="${selector.slice(1)}"`) ? {} : null,
      querySelectorAll: () => [],
    };
    return this.shadowRoot;
  }
  dispatchEvent(event) { this.events.push(event); }
}
class CustomEvent {
  constructor(type, options) { this.type = type; Object.assign(this, options); }
}
vm.runInNewContext(fs.readFileSync('configuration/chauffage-planning-card.js', 'utf8'), {
  HTMLElement, CustomEvent, setTimeout, customElements: {
    get: name => registry.get(name), define: (name, value) => registry.set(name, value),
  },
});

const Card = registry.get('chauffage-planning-card');
async function check(existing) {
  const card = new Card();
  card.events = [];
  const schedules = existing ? [{entity: 'schedule.classique', name: 'Classique'}] : [];
  card.setConfig({schedules, active_schedule: existing ? 'schedule.classique' : '', rooms: [], temperature_sets: {}, revision: 4});
  assert.match(card.shadowRoot.innerHTML, /Créer un planning/);
  if (!existing) assert.match(card.shadowRoot.innerHTML, /Aucun planning/);
  card.screen = 'create';
  card.createName = 'Vacances';
  card.render = () => {};
  card.load = async () => { card.draft = {monday: []}; };
  const calls = [];
  card._hass = {
    callWS: async message => {
      calls.push(message.type);
      if (message.type === 'schedule/create') return {id: 'vacances', name: 'Vacances'};
      if (message.type === 'config/entity_registry/list') return [{platform: 'schedule', unique_id: 'vacances', entity_id: 'schedule.vacances'}];
      if (message.type === 'get_states') return [{entity_id: 'schedule.vacances', state: 'off'}];
      throw Error('Unexpected request: ' + message.type);
    },
    callService: async (domain, service, data) => { calls.push([domain, service, data]); },
  };
  await card.createSchedule();
  assert.equal(card.screen, 'choose');
  assert.equal(card.config.schedules.at(-1).entity, 'schedule.vacances');
  assert.equal(card.config.active_schedule, existing ? 'schedule.classique' : 'schedule.vacances');
  assert.equal(card.config.revision, 5);
  assert.equal(card.events[0].type, 'chauffage-planning-created');
  assert.deepEqual(calls.slice(0, 3), ['schedule/create', 'config/entity_registry/list', 'get_states']);
  assert.equal(calls[3][2].operation, 'settings');
  assert.equal(calls[3][2].payload.schedules.length, existing ? 2 : 1);
}

(async () => {
  await check(false);
  await check(true);
  console.log('schedule creation OK');
})().catch(error => { console.error(error); process.exitCode = 1; });

