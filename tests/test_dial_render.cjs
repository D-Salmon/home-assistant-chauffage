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
const room = {id:'r1',name:'Salon',entity:'climate.salon',mode:'planning',
  temperatures:{confort:20,eco:17,nuit:17,absent:14},override:null};
const settings = {enabled:true,absent:false,schedules:[],active_schedule:'',house_name:'Maison',relay:'switch.boiler'};
const relayState = {state:'off'};
const valveState = {attributes:{temperature:20}};
const registryState = {entity_id:'sensor.registry',attributes:{integration:'ma_maison_chauffage',
  configuration:{revision:1,rooms:[room],settings},status:{rooms:[{id:'r1',current_temperature:19,temperature:20,target:20,hvac_action:'idle'}],relay:'off'}}};
card.setConfig({});
card.hass = {states:{'sensor.registry':registryState,'switch.boiler':relayState,'climate.salon':valveState}};
card.view = 'room';card.selected = 'r1';card.render();
assert.match(card.shadowRoot.innerHTML, /data-nav="home" aria-pressed="false"/);
assert.doesNotMatch(card.shadowRoot.innerHTML, /\.room-card \.nav button\[data-nav="home"\]\{color:#3475eb/);
assert.match(card.shadowRoot.innerHTML, /id="temperature-dial"[^>]*role="slider"[^>]*tabindex="0"/);
assert.match(card.shadowRoot.innerHTML, /aria-valuenow="20"/);
assert.match(card.shadowRoot.innerHTML, /class="dial-readout"[^>]*>20 °C</);
assert.match(card.shadowRoot.innerHTML, /stroke-dasharray:75 100/);
assert.match(card.shadowRoot.innerHTML, /Consigne demandée : 20 °C\. Consigne lue sur climate\.salon : 20 °C/);
const live = registryState.attributes.status.rooms[0];
live.target = null;live.temperature = 22;valveState.attributes.temperature = 22;
card.view = 'home';card.render();
assert.match(card.shadowRoot.innerHTML, /class="setpoint" aria-label="Consigne 22 °C">22 °C<\/span>/);
card.view = 'room';card.render();
assert.match(card.shadowRoot.innerHTML, /class="dial-readout"[^>]*>22 °C</);
const originalQuery = card.shadowRoot.querySelector;
const fakeNode = () => ({textContent:'',value:'22',style:{},disabled:false,attributes:{},setAttribute(key,value){this.attributes[key]=value;},getAttribute(key){return this.attributes[key];}});
const nodes = new Map(['.room-detail-temperature strong','.room-detail-target strong','.room-detail .hero-status strong','.room-detail .hero-status small','#temperature-dial','#override-temp','.dial-fill','.dial-thumb','.dial-readout','#override-minus','#override-plus'].map(key=>[key,fakeNode()]));
nodes.get('#temperature-dial').attributes['aria-disabled']='false';
nodes.set('.room-detail .hero',{classList:{toggle(){}}});
card.shadowRoot.querySelector = key => nodes.get(key)||null;
live.temperature = 23;valveState.attributes.temperature = 23;
card.hass = {states:{'sensor.registry':registryState,'switch.boiler':relayState,'climate.salon':valveState}};
assert.equal(nodes.get('#override-temp').value,'23');
assert.equal(nodes.get('.dial-readout').textContent,'23 °C');
card.dialTouched=true;live.temperature=24;
card.hass = {states:{'sensor.registry':registryState,'switch.boiler':relayState,'climate.salon':valveState}};
assert.equal(nodes.get('#override-temp').value,'23');
card.shadowRoot.querySelector = originalQuery;card.dialTouched=false;
live.target=20;live.temperature=20;valveState.attributes.temperature=20;
room.override = {temperature:21,until:4102444800};
card.render();
assert.match(card.shadowRoot.innerHTML, /aria-valuenow="21"/);
assert.match(card.shadowRoot.innerHTML, /Consigne active jusqu’au/);
assert.match(card.shadowRoot.innerHTML, /Enregistrer et reprendre ce mode/);
assert.match(card.shadowRoot.innerHTML, /Consigne demandée : 21 °C\. Consigne lue sur climate\.salon : 20 °C\. La valeur de l’entité n’a pas encore suivi\./);
valveState.attributes.temperature=21;
card.render();
assert.match(card.shadowRoot.innerHTML, /Les valeurs correspondent dans Home Assistant\./);
assert.match(card.shadowRoot.innerHTML, /id="resume-mode"/);
assert.match(card.shadowRoot.innerHTML, /Reprendre maintenant/);
assert.match(card.shadowRoot.innerHTML, /class="room-detail-target"[^>]*>.*<strong>21 °C<\/strong>/s);
card.view = 'home';card.render();
assert.match(card.shadowRoot.innerHTML, /class="setpoint" aria-label="Consigne 21 °C">21 °C<\/span>/);
assert.match(card.shadowRoot.innerHTML, /Consigne temporaire/);
card.view = 'room';
card.render();
assert.match(card.shadowRoot.innerHTML, /Consigne demandée : 21 °C\. Consigne lue sur climate\.salon : 21 °C/);
room.mode = 'confort';
card.render();
assert.match(card.shadowRoot.innerHTML, /id="temperature-dial"[^>]*tabindex="0"[^>]*aria-disabled="false"/);
assert.match(card.shadowRoot.innerHTML, /<option value="confort" selected>Confort<\/option>/);
room.override.until=1;
card.render();
assert.doesNotMatch(card.shadowRoot.innerHTML, /Consigne active jusqu’au/);
assert.doesNotMatch(card.shadowRoot.innerHTML, /id="resume"/);
assert.match(card.shadowRoot.innerHTML, /Consigne demandée : 20 °C\. Consigne lue sur climate\.salon : 21 °C/);
card.view = 'home';card.render();
assert.match(card.shadowRoot.innerHTML, /class="setpoint" aria-label="Consigne 20 °C">20 °C<\/span>/);
card.view = 'room';
settings.enabled = false;
card.render();
assert.match(card.shadowRoot.innerHTML, /id="temperature-dial"[^>]*tabindex="-1"[^>]*aria-disabled="true"/);
assert.match(card.shadowRoot.innerHTML, /type="submit" disabled>Appliquer/);
assert.match(card.shadowRoot.innerHTML, /\.dial-wrap\{position:relative;width:min\(100%,240px\)/);
registryState.attributes.status.rooms[0].hvac_action = 'heating';
card.view = 'home';card.render();
assert.match(card.shadowRoot.innerHTML, /data-nav="home" aria-pressed="true"/);
assert.doesNotMatch(card.shadowRoot.innerHTML, /class="room-icon heating"/);
assert.doesNotMatch(card.shadowRoot.innerHTML, /<header class="hero heating"/);
relayState.state = 'on';
card.render();
assert.match(card.shadowRoot.innerHTML, /class="room-icon heating"/);
assert.match(card.shadowRoot.innerHTML, /<header class="hero heating"/);
assert.match(card.shadowRoot.innerHTML, /\.rooms-panel \.room-icon\.heating ha-icon\{color:#d6322e;animation:heat-pulse/);
card.view = 'room';card.render();
assert.match(card.shadowRoot.innerHTML, /<header class="hero heating"/);
registryState.attributes.status.relay = 'on';
relayState.state = 'off';
card.render();
assert.doesNotMatch(card.shadowRoot.innerHTML, /<header class="hero heating"/);
card.view = 'home';
card.render();
assert.doesNotMatch(card.shadowRoot.innerHTML, /class="room-icon heating"/);
assert.doesNotMatch(card.shadowRoot.innerHTML, /<header class="hero heating"/);
console.log('room dial render OK');
