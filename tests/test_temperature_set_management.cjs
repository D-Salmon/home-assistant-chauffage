const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const registry = new Map();
class HTMLElement {
  attachShadow() {
    this.shadowRoot = {
      innerHTML: '', nodes: {},
      querySelector(selector) {
        const id = selector.startsWith('#') ? selector.slice(1) : null;
        return id && this.innerHTML.includes(`id="${id}"`) ? (this.nodes[selector] ||= {onclick: null}) : null;
      },
      querySelectorAll() { return []; },
    };
    return this.shadowRoot;
  }
  dispatchEvent(event) { this.events.push(event); }
}
class CustomEvent { constructor(type) { this.type = type; } }
vm.runInNewContext(fs.readFileSync('configuration/chauffage-planning-card.js', 'utf8'), {
  HTMLElement, CustomEvent, customElements: {get: name => registry.get(name), define: (name, value) => registry.set(name, value)},
});
const card = new (registry.get('chauffage-planning-card'))();
card.events = [];
card.setConfig({schedules: [{name: 'Classique', entity: 'schedule.classique'}], rooms: [
  {id: 'chambre', name: 'Chambre', temperatures: {confort: 21, eco: 17, nuit: 16, absent: 10}},
], temperature_sets: {set_123: {name: "Pas d'enfants", temperatures: {chambre: 17}}}, revision: 5});
assert.ok(card.shadowRoot.innerHTML.includes('Gérer les jeux de températures'));
card.screen = 'sets';
card.render();
for (const name of ['Confort', 'Éco', 'Nuit', 'Absent', 'Pas d&#39;enfants']) {
  assert.ok(card.shadowRoot.innerHTML.includes(name), name);
}
assert.ok(card.shadowRoot.innerHTML.includes('data-delete-set="set_123"'));
assert.match(card.shadowRoot.innerHTML, /data-open-set="set_123"[^>]*>Modifier les températures<\/button>/);
assert.ok(!card.shadowRoot.innerHTML.includes('data-delete-set="eco"'));
assert.ok(card.shadowRoot.innerHTML.indexOf('id="new-set"') > card.shadowRoot.innerHTML.indexOf('Pas d&#39;enfants'));

const calls = [];
card._hass = {
  callWS: async () => [{tuesday: [{data: {profil: 'set_123'}}]}],
  callService: async (...args) => calls.push(args),
};
(async () => {
  await card.removeSet('set_123');
  assert.equal(calls.length, 0);
  assert.match(card.message, /utilisé dans un planning/);
  card._hass.callWS = async () => [{tuesday: [{data: {profil: 'eco'}}]}];
  await card.removeSet('set_123');
  assert.equal(calls[0][2].operation, 'remove_temperature_set');
  assert.equal(calls[0][2].payload.id, 'set_123');
  assert.equal(card.events[0].type, 'chauffage-temperature-set-removed');
  card.selectSet('confort');
  assert.equal(card.setDraft.temperatures.chambre, 21);
  assert.ok(card.shadowRoot.innerHTML.includes('data-range-room="chambre"'));
  assert.ok(!card.shadowRoot.innerHTML.includes('id="set-name"'));
  card.setDraft.temperatures.chambre = 22;
  await card.saveSet();
  assert.equal(calls[1][2].operation, 'save_profile_temperatures');
  assert.equal(calls[1][2].payload.profile, 'confort');
  assert.equal(calls[1][2].payload.temperatures.chambre, 22);
  assert.equal(card.events[1].type, 'chauffage-temperature-set-saved');
  assert.equal(card.screen, 'sets');
  card.screen = 'sets';
  card.render();
  card.shadowRoot.querySelector('#new-set').onclick();
  assert.equal(card.screen, 'set');
  assert.ok(card.shadowRoot.innerHTML.includes('Nouveau jeu de températures'));
  card.setDraft.name = 'Soirée';
  await card.saveSet();
  assert.equal(calls[2][2].operation, 'save_temperature_set');
  assert.equal(calls[2][2].payload.name, 'Soirée');
  assert.equal(card.screen, 'sets');
  console.log('temperature set management OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
