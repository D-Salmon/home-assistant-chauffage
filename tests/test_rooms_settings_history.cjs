const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const registry = new Map();
class HTMLElement {
  attachShadow() {
    this.shadowRoot={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]};
    return this.shadowRoot;
  }
}
vm.runInNewContext(fs.readFileSync('www/ma-maison-chauffage-card.js','utf8'),{
  HTMLElement,Date,Intl,window:{customCards:[]},customElements:{get:name=>registry.get(name),define:(name,value)=>registry.set(name,value)}
});
const card=new (registry.get('ma-maison-chauffage-card'))();
const room={id:'r1',name:'Chambre',entity:'climate.chambre',mode:'planning',temperatures:{confort:21,eco:17,nuit:17,absent:14}};
const settings={house_name:'Maison',relay:'switch.boiler',schedules:[],active_schedule:'',enabled:true,absent:false,anticipation_window_days:14,outdoor_sensor:'sensor.dehors',confirm_seconds:30,stop_seconds:30,minimum_off:60,freshness_minutes:120,temperature_sets:{children:{name:'Pas d’enfants',temperatures:{r1:17.5}}}};
const entity={entity_id:'sensor.registry',attributes:{integration:'ma_maison_chauffage',configuration:{revision:1,rooms:[room],settings},status:{rooms:[{id:'r1',current_temperature:20,temperature:21,target:21,hvac_action:'idle'}],relay:'off'}}};
card.setConfig({});
card.hass={states:{'sensor.registry':entity,'switch.boiler':{state:'off',attributes:{friendly_name:'Chaudière'}},'climate.chambre':{state:'heat',attributes:{}},'sensor.dehors':{state:'8',attributes:{unit_of_measurement:'°C',friendly_name:'Dehors'}}},callWS:async()=>({})};
card.view='manage';card.render();
assert.match(card.shadowRoot.innerHTML,/class="manage-row"/);
assert.match(card.shadowRoot.innerHTML,/Actuelle <strong>20 °C/);
assert.match(card.shadowRoot.innerHTML,/data-edit="r1"/);
card.view='edit';card.selected='r1';card.render();
assert.match(card.shadowRoot.innerHTML,/Identification/);
assert.match(card.shadowRoot.innerHTML,/Capteurs facultatifs/);
assert.doesNotMatch(card.shadowRoot.innerHTML,/Températures de la pièce/);
assert.doesNotMatch(card.shadowRoot.innerHTML,/name="temperature_(?:confort|eco|set_children)"/);
card.view='settings';card.render();
assert.match(card.shadowRoot.innerHTML,/Plannings et météo/);
assert.match(card.shadowRoot.innerHTML,/Délais de pilotage/);
assert.match(card.shadowRoot.innerHTML,/value="14" selected>14 jours/);
assert.match(card.shadowRoot.innerHTML,/value="sensor.dehors" selected/);
card.view='history';card.selected='r1';
const now=Date.now();
card.historyStart=new Date(now-86400000);card.historyEnd=new Date(now);
card.historyData=[{lu:(now-3600000)/1000,a:{current_temperature:19,temperature:21}},{lu:now/1000,a:{current_temperature:20,temperature:21}}];
card.render();
assert.match(card.shadowRoot.innerHTML,/Historique des températures/);
assert.match(card.shadowRoot.innerHTML,/class="history-current" points="[^"]+"/);
assert.match(card.shadowRoot.innerHTML,/class="history-target" points="[^"]+"/);
(async()=>{
  card.historyPeriod='7d';
  card._hass.callWS=async request=>{
    assert.equal(request.type,'history/history_during_period');
    assert.deepEqual(Array.from(request.entity_ids),['climate.chambre']);
    assert.equal(request.no_attributes,false);
    return {'climate.chambre':[{lu:Date.now()/1000,a:{current_temperature:20.5,temperature:21}}]};
  };
  await card.loadRoomHistory();
  assert.equal(card.historyData.length,1);
  assert.match(card.shadowRoot.innerHTML,/7 jours/);
  console.log('rooms, settings and history render OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
