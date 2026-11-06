const fs=require('fs'),vm=require('vm'),assert=require('assert');
let Card;
const context={HTMLElement:class{attachShadow(){this.shadowRoot={};}},customElements:{get(){},define(name,c){Card=c;}}};
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../configuration/chauffage-planning-card.js'),'utf8'),context);
const clone=x=>JSON.parse(JSON.stringify(x));
(async()=>{
 let live={id:'stored-id',name:'Chauffage habituel',monday:[{from:'06:00:00',to:'08:00:00',data:{profil:'confort',keep:'yes'}}]};
 let calls=[];
 const card=new Card();card.render=()=>{};
 card.config={schedules:[{name:'Habituel',entity:'schedule.chauffage_habituel'}]};
 card._hass={callWS:async msg=>{
   calls.push(clone(msg));
   if(msg.type==='config/entity_registry/get'){assert.equal(msg.entity_id,'schedule.chauffage_habituel');return {entity_id:'schedule.chauffage_habituel',platform:'schedule',unique_id:'stored-id'};}
   if(msg.type==='schedule/list')return [clone(live)];
   if(msg.type==='schedule/update'){const {type,schedule_id,...rest}=msg;live={id:schedule_id,...rest};return clone(live);}
   throw Error('Unexpected operation');
 }};
 await card.load();assert.equal(card.draft.id,'stored-id');
 card.draft.monday.push({from:'22:00',to:'24:00',data:{profil:'nuit'}});
 await card.save();assert.equal(live.monday[1].to,'24:00:00');assert.equal(live.monday[1].data.profil,'nuit');assert.equal(live.monday[0].data.keep,'yes');
 let count=calls.filter(x=>x.type==='schedule/update').length;
 card.draft.monday.push({from:'23:00',to:'24:00',data:{profil:'absent'}});await card.save();assert(card.message.includes('chevauchent'));assert.equal(calls.filter(x=>x.type==='schedule/update').length,count);
 await card.load();card.draft.monday[0].data.profil='invalid';await card.save();assert(card.message.includes('profil valide'));
 await card.load();card.draft.monday[0].to='05:00';await card.save();assert(card.message.includes('après'));
 await card.load();live.name='Changed elsewhere';await card.save();assert(card.message.includes('changé ailleurs'));assert.equal(calls.filter(x=>x.type==='schedule/update').length,count);
 await card.load();card.draft.monday[0].data.profil='absent';await card.save();assert.equal(live.monday[0].data.profil,'absent');
 console.log('PASS: éditeur planning — lecture par registre, 24h, profils, préservation des données, chevauchements et conflits bloqués. API HA simulée.');
})().catch(e=>{console.error(e);process.exitCode=1;});
