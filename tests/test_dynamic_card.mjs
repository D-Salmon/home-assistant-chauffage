import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Window } from 'happy-dom';

const window = new Window({url:'http://ha.test'});
const clone=x=>JSON.parse(JSON.stringify(x));
let model={revision:0,rooms:[],settings:{enabled:false,absent:false,relay:'switch.boiler',schedules:[],active_schedule:'',confirm_seconds:30,stop_seconds:30,minimum_off:180,freshness_minutes:120}};
let calls=[];
function states(){
  const result={
    'sensor.registry':{entity_id:'sensor.registry',attributes:{integration:'ma_maison_chauffage',configuration:clone(model),status:{rooms:model.rooms.map(r=>({id:r.id,current_temperature:19,temperature:20,profile:r.mode})),relay:'off',faults:[]}}},
    'switch.boiler':{entity_id:'switch.boiler',attributes:{friendly_name:'Chaudière'}},
    'schedule.week':{entity_id:'schedule.week',attributes:{friendly_name:'Semaine'}},
    'sensor.outdoor':{entity_id:'sensor.outdoor',state:'8.5',attributes:{friendly_name:'Extérieur',unit_of_measurement:'°C'}}
  };
  for(let i=0;i<22;i++)result['climate.valve_'+i]={entity_id:'climate.valve_'+i,attributes:{friendly_name:'Vanne '+i}};
  return result;
}
const hass={
  states:states(),
  async callWS(message){assert.equal(message.type,'get_states');return Object.values(states());},
  async callService(domain,service,data){
    assert.equal(domain,'ma_maison_chauffage');assert.equal(service,'command');
    calls.push(clone(data));
    if(data.revision!==model.revision)throw Error('Les réglages ont changé ailleurs.');
    const p=data.payload;
    if(data.operation==='save_room'){
      if(p.id)model.rooms[model.rooms.findIndex(r=>r.id===p.id)]={...model.rooms.find(r=>r.id===p.id),...p};
      else model.rooms.push({id:'room_'+model.revision,mode:'planning',last_seen:'',override:null,...p});
    }else if(data.operation==='remove_room')model.rooms=model.rooms.filter(r=>r.id!==p.id);
    else if(data.operation==='settings')model.settings={...model.settings,...p};
    else if(data.operation==='override')model.rooms.find(r=>r.id===p.id).override={temperature:p.temperature,until:Date.now()/1000+p.hours*3600};
    else if(data.operation==='resume'){const r=model.rooms.find(r=>r.id===p.id);r.mode='planning';r.override=null;}
    model.revision++;
  }
};
window.eval(fs.readFileSync('www/ma-maison-chauffage-card.js','utf8'));
const card=window.document.createElement('ma-maison-chauffage-card');
window.document.body.append(card);
card.setConfig({type:'custom:ma-maison-chauffage-card'});card.hass=hass;
const q=s=>{const e=card.shadowRoot.querySelector(s);assert(e,'Missing '+s);return e;};
const all=s=>[...card.shadowRoot.querySelectorAll(s)];
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));assert.equal(card.busy,false);};
function submit(selector){q(selector).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));}
function input(selector,value){q(selector).value=value;q(selector).dispatchEvent(new window.Event('input',{bubbles:true}));}

assert.equal(all('.outdoor-tile').length,0);
model.settings.outdoor_sensor='sensor.outdoor';hass.states=states();card.hass=hass;
assert.equal(q('.outdoor-tile strong').textContent,'8,5 °C');
hass.states['sensor.outdoor'].state='unavailable';card.hass=hass;
assert.equal(all('.outdoor-tile').length,0);
model.settings.outdoor_sensor='';hass.states=states();card.hass=hass;

q('[data-nav="manage"]').click();q('#add').click();
input('#room-name','Chambre enfant');input('#room-entity','climate.valve_0');
input('#absent','13');input('#mode','absent');submit('#room-form');await settle();
assert.equal(model.rooms.length,1);assert.equal(model.rooms[0].temperatures.absent,13);assert.equal(model.rooms[0].mode,'absent');
q('[data-nav="home"]').click();assert.equal(all('[data-room]').length,1);
q('[data-room]').click();assert.equal(q('#mode').value,'absent',q('#mode').outerHTML+' '+JSON.stringify(card.model.rooms));
assert.equal(q('.room-detail .hero-title h2').textContent,'Chambre enfant');
assert.equal(q('.room-detail-temperature strong').textContent,'19 °C');
assert.equal(q('.room-detail-target strong').textContent,'20 °C');
assert.equal(q('.room-detail-override h3').textContent,'Consigne temporaire');
assert.equal(q('.room-detail-override button[type="submit"]').disabled,true);
const beforeTemperatureClick=calls.length;q('#absent').click();assert.equal(calls.length,beforeTemperatureClick,'Le champ température Absent ne doit pas activer une absence maison.');
input('#eco','16');input('#mode','planning');submit('#room-form');await settle();assert.equal(model.rooms[0].temperatures.eco,16);
model.settings.enabled=true;hass.states=states();card.hass=hass;
q('[data-nav="home"]').click();q('[data-room]').click();
assert.equal(q('.room-detail-override button[type="submit"]').disabled,false);
input('#override-temp','21');input('#hours','2');submit('#override-form');await settle();
assert.deepEqual(calls.at(-1).payload,{id:model.rooms[0].id,temperature:21,hours:2});
assert.equal(q('.room-detail .override-until').textContent.includes('Consigne active jusqu’au'),true);
q('#resume').click();await settle();assert.equal(model.rooms[0].override,null);
q('#room-back').click();assert.equal(all('[data-room]').length,1);

// The rendered list follows the registry, not eight hard-coded rows.
for(let i=1;i<20;i++)model.rooms.push({id:'extra_'+i,name:'Room '+i,entity:'climate.valve_'+i,temperatures:{confort:20,eco:17,nuit:17,absent:14},mode:'planning',last_seen:'',override:null});
model.revision++;hass.states=states();card.hass=hass;q('[data-nav="home"]').click();assert.equal(all('[data-room]').length,20);
q('[data-nav="manage"]').click();q('[data-edit]').click();
assert(!all('#room-entity option').some(o=>o.value==='climate.valve_1'));
input('#room-name','<img src=x onerror=alert(1)>');submit('#room-form');await settle();
assert.equal(all('img').length,0);assert(card.shadowRoot.textContent.includes('<img src=x onerror=alert(1)>'));

// An external state refresh must not discard an unsaved form or its revision.
q('[data-edit]').click();input('#room-name','My unsaved name');const revision=card.formRevision;
model.revision++;hass.states=states();card.hass=hass;
assert.equal(q('#room-name').value,'My unsaved name');assert.equal(card.formRevision,revision);
submit('#room-form');await settle();assert(q('#message').textContent.includes('changé ailleurs'));assert.equal(q('#room-name').value,'My unsaved name');
q('#cancel').click();
q('[data-nav="manage"]').click();q('[data-remove]').click();
assert.equal(model.rooms.length,20);q('#confirm-remove').click();await settle();assert.equal(model.rooms.length,19);
assert(!calls.some(c=>c.operation==='settings'&&c.payload.enabled===true));

// Bind arbitrary schedule entities via settings, without editing YAML.
q('[data-nav="settings"]').click();q('#schedules option').selected=true;
submit('#settings-form');await settle();assert.equal(model.settings.active_schedule,'schedule.week');
q('#absent').click();await settle();assert.equal(model.settings.absent,true);
assert.equal(all('[data-room]').length,19);
console.log('PASS: DOM simulé — ajout, profils, 20 pièces, échappement HTML, formulaires préservés, conflits, retrait confirmé et plannings.');
await window.happyDOM.close();
