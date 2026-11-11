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
        if (!id || !this.innerHTML.includes(`id="${id}"`)) return null;
        return this.nodes[selector] ||= {dataset: {}};
      },
      querySelectorAll(selector) {
        if (this.nodes[selector]?.html === this.innerHTML) return this.nodes[selector].items;
        const key = selector === '[data-day]' ? 'day' : selector === '[data-open-block]' ? 'open-block' : '';
        if (!key) return [];
        const items = [...this.innerHTML.matchAll(new RegExp(`data-${key}="([^"]+)"`, 'g'))]
          .map(match => ({dataset: {[key.replace('-b', 'B')]: match[1]}}));
        this.nodes[selector] = {html: this.innerHTML, items};
        return items;
      },
    };
    return this.shadowRoot;
  }
}
vm.runInNewContext(fs.readFileSync('configuration/chauffage-planning-card.js', 'utf8'), {
  HTMLElement, customElements: {get: name => registry.get(name), define: (name, value) => registry.set(name, value)},
});

const card = new (registry.get('chauffage-planning-card'))();
card.setConfig({schedules: [{name: 'Classique', entity: 'schedule.classique'}], active_schedule: 'schedule.classique', rooms: [
  {id: 'valentine', name: 'Chambre Valentine', temperatures: {confort: 21, eco: 17}},
], temperature_sets: {set_123: {name: "Pas d'enfants", temperatures: {valentine: 17}}}});
card.draft = {monday: [{from: '00:00', to: '24:00', data: {profil: 'set_123'}}]};
for (const day of ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) card.draft[day] = [];
card.render();
assert.equal(card.screen, 'choose');
assert.ok(card.shadowRoot.innerHTML.includes('Choisissez un jour'));
assert.ok(!card.shadowRoot.innerHTML.includes('Chambre Valentine'));
card.shadowRoot.querySelectorAll('[data-day]')[0].onclick();
assert.equal(card.screen, 'overview');
assert.ok(card.shadowRoot.innerHTML.includes("Pas d&#39;enfants"));
assert.ok(card.shadowRoot.innerHTML.includes('Chambre Valentine'));
assert.ok(card.shadowRoot.innerHTML.includes('class="day-track"'));
assert.ok(card.shadowRoot.innerHTML.includes('class="time-segment"'));
assert.ok(card.shadowRoot.innerHTML.includes('aria-label="Ajouter une plage horaire"'));
card.shadowRoot.querySelector('#copy-weekdays').onclick();
assert.equal(card.draft.friday[0].data.profil, 'set_123');
assert.equal(card.draft.saturday.length, 0);
assert.equal(card.dirty, true);
card.shadowRoot.querySelectorAll('[data-day]')[1].onclick();
card.shadowRoot.querySelector('#add').onclick();
assert.equal(card.screen, 'block');
assert.ok(card.shadowRoot.innerHTML.includes('Ajouter une plage horaire'));
assert.ok(!card.shadowRoot.innerHTML.includes('Nouveau jeu de températures'));
const added = card.draft.tuesday[card.editIndex];
added.from = '09:00';
added.to = '10:00';
card.shadowRoot.querySelector('#block-done').onclick();
assert.equal(card.screen, 'overview');
assert.equal(JSON.stringify(card.draft.tuesday.map(block => [block.from, block.to])), JSON.stringify([
  ['00:00', '09:00'], ['09:00', '10:00'], ['10:00', '24:00'],
]));
assert.equal(card.draft.tuesday[0].data.profil, 'set_123');
assert.equal(card.draft.tuesday[2].data.profil, 'set_123');
card.selectSet('set_123');
assert.ok(card.shadowRoot.innerHTML.includes('type="range"'));
assert.ok(card.shadowRoot.innerHTML.includes('data-range-room="valentine"'));
card.screen = 'overview';
card.draft.wednesday = [];
card.day = 'wednesday';
card.render();
assert.ok(card.shadowRoot.innerHTML.includes('Aucune plage'));
assert.ok(!card.shadowRoot.innerHTML.includes('class="day-track"'));
card.shadowRoot.querySelector('#add').onclick();
assert.equal(card.screen, 'block');
card.shadowRoot.querySelector('#from').onchange({target: {value: '6:30'}});
card.shadowRoot.querySelector('#to').onchange({target: {value: '8'}});
card.shadowRoot.querySelector('#block-done').onclick();
assert.equal(card.screen, 'overview');
assert.equal(card.day, 'wednesday');
assert.equal(card.draft.wednesday[0].from, '06:30');
assert.equal(card.draft.wednesday[0].to, '08:00');
card.shadowRoot.querySelector('#add').onclick();
card.shadowRoot.querySelector('#from').onchange({target: {value: '6'}});
card.shadowRoot.querySelector('#to').onchange({target: {value: '6:30'}});
card.shadowRoot.querySelector('#block-done').onclick();
assert.equal(card.draft.wednesday[0].from, '06:00');
assert.equal(card.draft.wednesday[0].to, '06:30');
card.day = 'thursday';
card.draft.thursday = [];
card.render();
card.shadowRoot.querySelector('#add').onclick();
card.shadowRoot.querySelector('#from').onchange({target: {value: '00:00'}});
card.shadowRoot.querySelector('#to').onchange({target: {value: '07:00'}});
card.shadowRoot.querySelector('#block-done').onclick();
assert.equal(card.screen, 'overview');
assert.equal(card.draft.thursday[0].from, '00:00');
assert.equal(card.draft.thursday[0].to, '07:00');
console.log('planning day flow OK');
