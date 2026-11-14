const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const registry = new Map();
class HTMLElement {
  attachShadow() {
    this.nodes = new Map();
    this.shadowRoot = {innerHTML:'',querySelector:selector=>this.nodes.get(selector)||null,querySelectorAll:()=>[]};
    return this.shadowRoot;
  }
  dispatchEvent() {}
}
class CustomEvent { constructor(type) { this.type=type; } }
vm.runInNewContext(fs.readFileSync('configuration/chauffage-planning-card.js','utf8'),{
  HTMLElement,CustomEvent,customElements:{get:name=>registry.get(name),define:(name,value)=>registry.set(name,value)}
});
const Card=registry.get('chauffage-planning-card');
const card=new Card();
card.setConfig({schedules:[{entity:'schedule.classique',name:'Classique'}],active_schedule:'schedule.classique',rooms:[]});
card.draft={id:'classique',name:'Classique',monday:[{from:'23:30',to:'24:00',data:{profil:'nuit'}}],tuesday:[{from:'00:00',to:'08:00',data:{profil:'eco'}}]};
card.original=JSON.parse(JSON.stringify(card.draft));
card.day='monday';card.screen='block';card.editIndex=0;card.newBlock=false;
card.nodes.set('#from',{value:'23:30'});
card.nodes.set('#to',{value:'06:30'});
card.nodes.set('#block-done',{});
card.render();
card.nodes.get('#block-done').onclick();
assert.deepEqual(JSON.parse(JSON.stringify(card.draft.monday)),[{from:'23:30',to:'24:00',data:{profil:'nuit'}}]);
assert.deepEqual(JSON.parse(JSON.stringify(card.draft.tuesday)),[
  {from:'00:00',to:'06:30',data:{profil:'nuit'}},
  {from:'06:30',to:'08:00',data:{profil:'eco'}}
]);
assert.match(card.message,/Lundi et Mardi/);
let savedRequest;
card._hass={callWS:async request=>{
  if(request.type==='schedule/list')return [card.original];
  if(request.type==='schedule/update'){
    savedRequest=request;
    const {type,schedule_id,...values}=request;
    return {id:schedule_id,...values};
  }
  throw new Error(`Unexpected call: ${request.type}`);
}};
const weekend=new Card();
weekend.setConfig({schedules:[{entity:'schedule.classique',name:'Classique'}],active_schedule:'schedule.classique',rooms:[]});
weekend.draft={sunday:[{from:'23:30',to:'06:30',data:{profil:'nuit'}}],monday:[]};
weekend.day='sunday';weekend.screen='block';weekend.editIndex=0;weekend.newBlock=false;
weekend.nodes.set('#block-done',{});
weekend.render();
weekend.nodes.get('#block-done').onclick();
assert.equal(weekend.draft.sunday[0].to,'24:00');
assert.equal(weekend.draft.monday[0].to,'06:30');
(async()=>{
  await card.save();
  assert.equal(savedRequest.monday[0].to,'24:00');
  assert.equal(savedRequest.tuesday[0].from,'00:00');
  assert.equal(savedRequest.tuesday[0].to,'06:30');
  assert.equal(card.draft.tuesday[0].to,'06:30');
  console.log('overnight schedule split and save OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
