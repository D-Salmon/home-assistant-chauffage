const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const registry = new Map();
class HTMLElement {
  attachShadow() {
    this.shadowRoot = {innerHTML: '', querySelector: () => null, querySelectorAll: () => []};
    return this.shadowRoot;
  }
  dispatchEvent(event) { this.events.push(event); }
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
async function check(schedules, active_schedule, changed = false, deleteFails = false) {
  const card = new Card();
  card.events = [];
  card.render = () => {};
  card.setConfig({schedules, active_schedule, rooms: [], revision: 9});
  card.index = 0;
  card.screen = 'choose';
  card.planDeleteConfirm = true;
  card.original = {id: 'classique', name: 'Classique', monday: []};
  card.draft = structuredClone(card.original);
  card.load = async () => { card.draft = {monday: []}; };
  const calls = [];
  card._hass = {
    callWS: async message => {
      calls.push(message);
      if (message.type === 'schedule/list') return [changed ? {id: 'classique', name: 'Classique', monday: [{from: '09:00', to: '10:00'}]} : structuredClone(card.original)];
      if (message.type === 'config/entity_registry/get') return {platform: 'schedule', unique_id: 'classique'};
      if (message.type === 'schedule/delete') { if (deleteFails) throw Error('HA indisponible'); return null; }
      throw Error('Unexpected request: ' + message.type);
    },
    callService: async (domain, service, data) => { calls.push([domain, service, data]); },
  };
  await card.deleteSchedule();
  if (changed) {
    assert.equal(calls.length, 2);
    assert.match(card.message, /changé ailleurs/);
    assert.equal(card.config.schedules.length, schedules.length);
    return;
  }
  assert.equal(calls[2][2].operation, 'settings');
  assert.equal(calls[2][2].revision, 9);
  assert.equal(calls[3].type, 'schedule/delete');
  assert.equal(calls[3].schedule_id, 'classique');
  assert.equal(card.config.schedules.length, schedules.length - 1);
  assert.equal(card.config.active_schedule, schedules.length > 1 ? 'schedule.vacances' : '');
  assert.equal(card.events[0].type, 'chauffage-planning-removed');
  assert.equal(card.screen, 'choose');
  assert.match(card.message, deleteFails ? /supprimez cet assistant dans HA/i : /supprimé de la carte et de Home Assistant/);
}

(async () => {
  const classique = {entity: 'schedule.classique', name: 'Classique'};
  const vacances = {entity: 'schedule.vacances', name: 'Vacances'};
  await check([classique, vacances], 'schedule.classique');
  await check([classique], 'schedule.classique');
  await check([classique, vacances], 'schedule.classique', true);
  await check([classique, vacances], 'schedule.classique', false, true);
  console.log('schedule deletion OK');
})().catch(error => { console.error(error); process.exitCode = 1; });

