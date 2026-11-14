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
}
vm.runInNewContext(fs.readFileSync('configuration/chauffage-planning-card.js','utf8'),{
  HTMLElement,customElements:{get:name=>registry.get(name),define:(name,value)=>registry.set(name,value)}
});
const Card=registry.get('chauffage-planning-card');
const card=new Card();
card.setConfig({schedules:[{entity:'schedule.classique',name:'Classique'}],active_schedule:'schedule.classique',rooms:[]});
card.draft={monday:[{from:'23:30',to:'24:00',data:{profil:'nuit'}}],tuesday:[{from:'00:00',to:'08:00',data:{profil:'eco'}}]};
card.day='monday';card.screen='block';card.editIndex=0;card.newBlock=false;
card.draft.monday[0].to='06:30';
card.nodes.set('#block-done',{});
card.render();
card.nodes.get('#block-done').onclick();
assert.deepEqual(JSON.parse(JSON.stringify(card.draft.monday)),[{from:'23:30',to:'24:00',data:{profil:'nuit'}}]);
assert.deepEqual(JSON.parse(JSON.stringify(card.draft.tuesday)),[
  {from:'00:00',to:'06:30',data:{profil:'nuit'}},
  {from:'06:30',to:'08:00',data:{profil:'eco'}}
]);
assert.match(card.message,/Lundi et Mardi/);
const weekend=new Card();
weekend.setConfig({schedules:[{entity:'schedule.classique',name:'Classique'}],active_schedule:'schedule.classique',rooms:[]});
weekend.draft={sunday:[{from:'23:30',to:'06:30',data:{profil:'nuit'}}],monday:[]};
weekend.day='sunday';weekend.screen='block';weekend.editIndex=0;weekend.newBlock=false;
weekend.nodes.set('#block-done',{});
weekend.render();
weekend.nodes.get('#block-done').onclick();
assert.equal(weekend.draft.sunday[0].to,'24:00');
assert.equal(weekend.draft.monday[0].to,'06:30');
console.log('overnight schedule split OK');
