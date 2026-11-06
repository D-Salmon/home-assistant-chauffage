/* Dynamic Ma maison card. One persisted room registry for UI and heating. */
(() => {
  const DOMAIN='ma_maison_chauffage';
  const PROFILES={confort:'Confort',eco:'Éco',nuit:'Nuit',absent:'Absent'};
  const MODES={planning:'Planning',...PROFILES};
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const temp=x=>typeof x==='number'&&Number.isFinite(x)?x.toLocaleString('fr-FR',{maximumFractionDigits:1})+' °C':'—';
  class MaMaisonCard extends HTMLElement {
    static getStubConfig(){return {type:'custom:ma-maison-chauffage-card'};}
    constructor(){super();this.attachShadow({mode:'open'});this.view='home';this.selected=null;this.dirty=false;this.busy=false;this.message='';}
    setConfig(config){this.config=config;this.render();}
    set hass(hass){
      this._hass=hass;this.readState(Object.values(hass.states));
      const planner=this.shadowRoot.querySelector('chauffage-planning-card');
      if(this.view==='planning'&&planner){planner.hass=hass;return;}
      if(!this.busy&&!this.dirty&&!['edit','room','settings'].includes(this.view))this.render();
    }
    readState(states){
      const entry=this.config?.entity?states.find(s=>s.entity_id===this.config.entity):states.find(s=>s.attributes?.integration===DOMAIN);
      this.model=entry?.attributes?.configuration;this.status=entry?.attributes?.status||{};
    }
    getCardSize(){return Math.max(5,(this.model?.rooms.length||0)+3);}
    async refresh(){this.readState(await this._hass.callWS({type:'get_states'}));}
    note(message){this.message=message;const node=this.shadowRoot.querySelector('#message');if(node)node.textContent=message;}
    async command(operation,payload,revision=this.model?.revision,nextView=null){
      if(this.busy)return;
      this.busy=true;this.shadowRoot.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{
        await this._hass.callService(DOMAIN,'command',{operation,payload,revision});
        this.dirty=false;await this.refresh();if(nextView)this.view=nextView;if(operation==='remove_room')this.pendingRemove=null;
        this.message='Modification enregistrée.';this.busy=false;this.render();
      }catch(e){this.busy=false;this.shadowRoot.querySelectorAll('button').forEach(b=>b.disabled=false);this.note(e.message||String(e));}
    }
    navigate(view,id=null){
      if(this.dirty||this.shadowRoot.querySelector('chauffage-planning-card')?.dirty){this.note('Enregistrez ou annulez les modifications avant de quitter cet écran.');return;}
      this.view=view;this.selected=id;this.pendingRemove=null;this.message='';this.render();
    }
    options(domain,selected='',exclude=[]){
      const ids=Object.keys(this._hass.states).filter(id=>id.startsWith(domain+'.')&&!exclude.includes(id));
      if(selected&&!ids.includes(selected))ids.unshift(selected);
      return '<option value="">Choisir…</option>'+ids.sort().map(id=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(this._hass.states[id]?.attributes?.friendly_name||id)} · ${esc(id)}</option>`).join('');
    }
    profileInputs(room){return Object.entries(PROFILES).map(([key,name])=>`<div><label for="${key}">${name} (°C)</label><input type="number" id="${key}" name="${key}" min="5" max="25" step="0.5" required value="${room.temperatures[key]}"></div>`).join('');}
    roomForm(room,editing){
      this.formRevision=this.model.revision;
      return `<form id="room-form"><h2>${editing?(room.id?'Modifier la pièce':'Ajouter une pièce'):esc(room.name)}</h2>
        ${editing?`<label for="room-name">Nom de la pièce</label><input id="room-name" name="name" required maxlength="80" value="${esc(room.name)}"><label for="room-entity">Vanne thermostatique</label><select id="room-entity" name="entity" required>${this.options('climate',room.entity,this.model.rooms.filter(r=>r.id!==room.id).map(r=>r.entity))}</select>`:''}
        <label for="mode">Mode de la pièce</label><select id="mode" name="mode">${Object.entries(MODES).map(([v,n])=>`<option value="${v}" ${room.mode===v?'selected':''}>${n}</option>`).join('')}</select>
        <div class="profiles">${this.profileInputs(room)}</div>
        ${editing?`<details><summary>Surveillance du dernier contact (facultative)</summary><label for="last-seen">Capteur horodaté ISO 8601</label><select id="last-seen" name="last_seen">${this.options('sensor',room.last_seen||'')}</select></details>`:''}
        <p class="hint">Planning suit les horaires. Un profil fixe reste actif jusqu’à votre changement. Absent permet de garder une chambre inoccupée à une température plus basse.</p>
        <div class="actions"><button class="primary" type="submit">Enregistrer</button><button type="button" id="cancel">Annuler</button></div></form>
        ${!editing?`<hr><form id="override-form"><h3>Consigne temporaire</h3><div class="profiles"><div><label for="override-temp">Température (°C)</label><input id="override-temp" name="temperature" type="number" min="5" max="25" step="0.5" value="${room.override?.temperature??room.temperatures.confort}" required></div><div><label for="hours">Durée (h)</label><input id="hours" name="hours" type="number" min="0.5" max="12" step="0.5" value="3" required></div></div><p class="hint">Disponible si le chauffage est actif, la maison présente et la pièce en mode Planning.</p>${room.override?`<p class="hint">Échéance : ${esc(new Date(room.override.until*1000).toLocaleString('fr-FR'))}</p>`:''}<div class="actions"><button class="primary" type="submit">Appliquer</button><button type="button" id="resume">Reprendre le planning</button></div></form>`:''}`;
    }
    render(){
      if(!this.config)return;
      if(!this.model){this.shadowRoot.innerHTML='<ha-card style="padding:24px">Ajoutez l’intégration « Ma maison - Chauffage » dans Paramètres → Appareils et services, puis rechargez cette carte.</ha-card>';return;}
      const m=this.model,s=m.settings,rooms=m.rooms,details=new Map((this.status.rooms||[]).map(r=>[r.id,r]));
      let content='';
      if(this.view==='home'){
        content=`<div class="hero"><h2>Ma maison</h2><p>${!s.enabled?'Chauffage arrêté':s.absent?'Maison absente':esc(s.schedules.find(p=>p.entity===s.active_schedule)?.name||'Choisir un planning')}</p><small>${rooms.length} pièce(s) · ${this.status.relay==='on'?'Demande chaudière active':this.status.relay==='off'?'Demande chaudière arrêtée':'Relais indisponible'}</small></div><div class="picker"><div><label for="active-plan">Mon planning</label><select id="active-plan"><option value="">Sans planning</option>${s.schedules.map(p=>`<option value="${esc(p.entity)}" ${p.entity===s.active_schedule?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div><button id="absent" type="button" aria-pressed="${s.absent}">Absent${s.absent?' ✓':''}</button></div><h3>Mes pièces</h3>${rooms.map(r=>{const live=details.get(r.id)||{};return `<button class="room" data-room="${r.id}"><span class="room-icon">${live.hvac_action==='heating'?'♨':'⌂'}</span><span><strong>${esc(r.name)}</strong><span>${temp(live.current_temperature)}</span><small>${esc(live.fault||MODES[live.profile]||live.profile||'En attente')}</small></span><span class="setpoint">${temp(live.temperature)}</span></button>`;}).join('')||'<p>Ajoutez votre première vanne dans Gérer les pièces.</p>'}<p class="hint">Salle de bain : le radiateur toujours ouvert chauffe avec le circuit.</p>`;
      }else if(this.view==='manage'){
        content=`<h2>Gérer les pièces</h2><p class="hint">${rooms.length} vanne(s). Cette liste pilote aussi les consignes et la chaudière.</p><button class="primary" id="add">+ Ajouter une vanne</button>${rooms.map(r=>`<div class="manage-row"><div><strong>${esc(r.name)}</strong><small>${esc(r.entity)}</small></div><div class="actions"><button data-edit="${r.id}">Modifier</button><button data-remove="${r.id}">Retirer</button></div></div>`).join('')}`;
        if(this.pendingRemove)content+=`<div class="warning"><p>Retirer ${esc(rooms.find(r=>r.id===this.pendingRemove)?.name)} de la gestion ? La vanne garde sa dernière consigne et peut encore chauffer avec le circuit. Mettez-la sur OFF dans HA si vous souhaitez l’arrêter.</p><button id="confirm-remove">Retirer de la gestion</button><button id="cancel-remove">Conserver</button></div>`;
      }else if(this.view==='edit'||this.view==='room'){
        const room=rooms.find(r=>r.id===this.selected)||(!this.selected?{name:'',entity:'',mode:'planning',last_seen:'',temperatures:{confort:20,eco:17,nuit:17,absent:14}}:null);
        content=room?this.roomForm(room,this.view==='edit'):'Cette pièce a été retirée. Revenez à l’accueil.';
      }else if(this.view==='settings'){
        this.formRevision=m.revision;
        content=`<form id="settings-form"><h2>Réglages</h2><label class="check"><input name="enabled" type="checkbox" ${s.enabled?'checked':''}>Chauffage autorisé</label><label for="relay">Relais chaudière</label><select id="relay" name="relay">${this.options('switch',s.relay)}</select><p class="hint">Pour changer de relais, arrêtez d’abord le chauffage et vérifiez que l’ancien relais est OFF.</p><label for="schedules">Plannings disponibles (sélection multiple)</label><select id="schedules" name="schedules" multiple size="5">${Object.keys(this._hass.states).filter(id=>id.startsWith('schedule.')).sort().map(id=>`<option value="${esc(id)}" ${s.schedules.some(p=>p.entity===id)?'selected':''}>${esc(this._hass.states[id].attributes.friendly_name||id)}</option>`).join('')}</select><p class="hint">Créez les assistants Planning dans HA, puis sélectionnez-les ici. Les horaires se modifient dans Plannings.</p><div class="profiles">${[['confirm_seconds','Confirmation de demande (s)',0,600],['stop_seconds','Délai d’arrêt (s)',0,300],['minimum_off','Repos minimal du relais (s)',0,1800],['freshness_minutes','Dernier contact maximal (min)',5,1500]].map(([k,n,min,max])=>`<div><label for="${k}">${n}</label><input name="${k}" id="${k}" type="number" min="${min}" max="${max}" value="${s[k]}" required></div>`).join('')}</div><div class="actions"><button type="submit" class="primary">Enregistrer</button><button type="button" id="cancel">Annuler</button></div></form><button id="retry">Réessayer les commandes du relais</button>`;
      }else if(this.view==='planning'){
        content=s.schedules.length?'<div id="planner"></div>':'Choisissez vos assistants Planning dans Réglages.';
      }
      this.shadowRoot.innerHTML=`<style>
        :host{display:block;font-family:system-ui,sans-serif;color:var(--primary-text-color)}*{box-sizing:border-box}ha-card{padding:18px;border-radius:24px}h2{font-size:24px;margin:0 0 16px}h3{font-size:17px;margin:22px 0 12px}p{line-height:1.5}label{display:block;font-size:13px;margin:14px 0 5px}input,select,button{font:inherit;font-size:15px;min-height:44px;padding:10px;border:1px solid var(--divider-color);border-radius:12px;color:inherit;background:var(--ha-card-background,var(--card-background-color));max-width:100%}input,select{width:100%;min-width:0}button{cursor:pointer}button:disabled{opacity:.5}.primary{background:#406bfa;color:white;border-color:#406bfa}.hero{background:linear-gradient(135deg,#192778,#4074ff);color:white;padding:24px;border-radius:20px;margin-bottom:16px}.hero p{margin-bottom:7px}.picker{display:grid;grid-template-columns:minmax(0,1fr) 95px;gap:10px;align-items:end}.picker label{margin-top:0}[aria-pressed=true]{background:#e8edff;color:#2747aa}.room{display:grid;grid-template-columns:44px minmax(0,1fr) 76px;width:100%;gap:12px;text-align:left;align-items:center;border:0;border-bottom:1px solid var(--divider-color);border-radius:0;padding:16px 0}.room strong,.room span span,small{display:block}.room small{margin-top:5px;color:var(--secondary-text-color);overflow-wrap:anywhere}.room-icon{font-size:26px;color:#e77829}.setpoint{padding:13px 5px;text-align:center;background:#406bfa;color:white;border-radius:14px}.profiles{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}.hint,small{font-size:12px;color:var(--secondary-text-color)}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.nav{display:flex;flex-wrap:wrap;gap:5px;margin-top:22px;border-top:1px solid var(--divider-color);padding-top:12px}.nav button{flex:1;font-size:12px;min-width:65px;padding:8px}.manage-row{padding:16px 0;border-bottom:1px solid var(--divider-color)}.manage-row small{overflow-wrap:anywhere;margin-top:5px}.check{display:flex;align-items:center;gap:9px}.check input{width:22px}.warning{padding:12px;background:var(--secondary-background-color);border-radius:12px}.warning button{margin:4px}#message{font-size:13px;white-space:pre-line;overflow-wrap:anywhere;margin-top:16px}details{margin-top:18px}hr{border:0;border-top:1px solid var(--divider-color);margin:22px 0}
      </style><ha-card>${content}<div id="message" role="status" aria-live="polite">${esc(this.message||(this.status.faults||[]).join('\n'))}</div><div class="nav">${[['home','Accueil'],['planning','Plannings'],['manage','Pièces'],['settings','Réglages']].map(([v,l])=>`<button data-nav="${v}" aria-pressed="${this.view===v}">${l}</button>`).join('')}</div></ha-card>`;
      const q=s=>this.shadowRoot.querySelector(s),all=s=>this.shadowRoot.querySelectorAll(s);
      all('[data-nav]').forEach(b=>b.onclick=()=>this.navigate(b.dataset.nav));
      all('[data-room]').forEach(b=>b.onclick=()=>this.navigate('room',b.dataset.room));
      all('[data-edit]').forEach(b=>b.onclick=()=>this.navigate('edit',b.dataset.edit));
      all('[data-remove]').forEach(b=>b.onclick=()=>{this.pendingRemove=b.dataset.remove;this.render();});
      if(q('#add'))q('#add').onclick=()=>this.navigate('edit');
      if(q('#confirm-remove'))q('#confirm-remove').onclick=()=>this.command('remove_room',{id:this.pendingRemove},m.revision,'manage');
      if(q('#cancel-remove'))q('#cancel-remove').onclick=()=>{this.pendingRemove=null;this.render();};
      if(q('#active-plan'))q('#active-plan').onchange=e=>this.command('settings',{active_schedule:e.target.value});
      if(this.view==='home'&&q('#absent'))q('#absent').onclick=()=>this.command('settings',{absent:!s.absent});
      if(q('#cancel'))q('#cancel').onclick=()=>{this.dirty=false;this.navigate('home');};
      if(q('#resume'))q('#resume').onclick=()=>this.command('resume',{id:this.selected},this.formRevision);
      if(q('#retry'))q('#retry').onclick=()=>this.command('retry',{});
      const roomForm=q('#room-form');if(roomForm){roomForm.oninput=()=>this.dirty=true;roomForm.onsubmit=e=>{e.preventDefault();const values=new FormData(roomForm),room=m.rooms.find(r=>r.id===this.selected),payload={name:room?.name,entity:room?.entity,mode:values.get('mode'),temperatures:Object.fromEntries(Object.keys(PROFILES).map(p=>[p,Number(values.get(p))]))};if(room)payload.id=room.id;if(this.view==='edit'){payload.name=values.get('name');payload.entity=values.get('entity');payload.last_seen=values.get('last_seen');}this.command('save_room',payload,this.formRevision,'manage');};}
      const override=q('#override-form');if(override)override.onsubmit=e=>{e.preventDefault();if(this.dirty){this.note('Enregistrez d’abord les réglages de la pièce.');return;}const v=new FormData(override);this.command('override',{id:this.selected,temperature:Number(v.get('temperature')),hours:Number(v.get('hours'))},this.formRevision);};
      const settings=q('#settings-form');if(settings){settings.oninput=()=>this.dirty=true;settings.onsubmit=e=>{e.preventDefault();const v=new FormData(settings),schedules=v.getAll('schedules').map(id=>({entity:id,name:s.schedules.find(p=>p.entity===id)?.name||this._hass.states[id].attributes.friendly_name||id}));const payload={enabled:v.has('enabled'),relay:v.get('relay'),schedules,active_schedule:schedules.some(p=>p.entity===s.active_schedule)?s.active_schedule:schedules[0]?.entity||''};for(const key of ['confirm_seconds','stop_seconds','minimum_off','freshness_minutes'])payload[key]=Number(v.get(key));this.command('settings',payload,this.formRevision,'home');};}
      // Set live form properties as well as initial HTML attributes.
      if(roomForm){const current=rooms.find(r=>r.id===this.selected);q('#mode').value=current?.mode||'planning';if(q('#room-entity'))q('#room-entity').value=current?.entity||'';if(q('#last-seen'))q('#last-seen').value=current?.last_seen||'';}
      if(settings){q('#relay').value=s.relay;all('#schedules option').forEach(o=>o.selected=s.schedules.some(p=>p.entity===o.value));}
      if(q('#active-plan'))q('#active-plan').value=s.active_schedule;
      if(q('#planner')){if(customElements.get('chauffage-planning-card')){const card=document.createElement('chauffage-planning-card');card.setConfig({schedules:s.schedules});card.hass=this._hass;q('#planner').append(card);}else q('#planner').textContent='Chargez aussi la ressource chauffage-planning-card.js.';}
    }
  }
  if(!customElements.get('ma-maison-chauffage-card'))customElements.define('ma-maison-chauffage-card',MaMaisonCard);
  window.customCards=window.customCards||[];
  window.customCards.push({type:'ma-maison-chauffage-card',name:'Ma maison - Chauffage',description:'Pièces et profils dynamiques, chaudière et plannings sans YAML au quotidien.',preview:false});
})();
