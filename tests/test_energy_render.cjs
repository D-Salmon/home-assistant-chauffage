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
  HTMLElement, Date, Intl, window: {customCards: []}, customElements: {
    get: name => registry.get(name), define: (name, value) => registry.set(name, value)
  }
});
const card = new (registry.get('ma-maison-chauffage-card'))();
const now = new Date();
const current = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const previous = new Date(now.getFullYear(), now.getMonth()-1, 1);
const last = `${previous.getFullYear()}-${String(previous.getMonth()+1).padStart(2,'0')}`;
const state = {entity_id:'sensor.registry',attributes:{integration:'ma_maison_chauffage',
  configuration:{revision:1,rooms:[],settings:{house_name:'Maison',relay:'switch.boiler',schedules:[],active_schedule:'',enabled:true,absent:false}},
  status:{rooms:[],relay:'off',usage:{months:{[current]:3600,[last]:7200},reset_at:null}}}};
card.setConfig({});
card.hass = {states:{'sensor.registry':state,'switch.boiler':{state:'off'}}};
card.view = 'energy';
card.render();
assert.match(card.shadowRoot.innerHTML, /data-nav="energy" aria-pressed="true"/);
assert.match(card.shadowRoot.innerHTML, /1 h 00/);
assert.match(card.shadowRoot.innerHTML, /2 h 00/);
assert.match(card.shadowRoot.innerHTML, /Remettre le compteur à zéro/);
card.energyPeriod = 'year';
card.energyResetConfirm = true;
card.render();
assert.match(card.shadowRoot.innerHTML, /Détail par mois/);
assert.match(card.shadowRoot.innerHTML, /Confirmer la remise à zéro/);
console.log('energy render OK');
