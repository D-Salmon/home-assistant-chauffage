/* Ma maison: weekly schedule editor for storage-backed HA Schedule helpers.
 * Install as /local/chauffage-planning-card.js?v=2 (JavaScript module).
 * Uses HA's schedule/list, schedule/update and entity registry APIs.
 */
(() => {
  const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const LABELS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
  const PROFILES = {confort:'Confort',eco:'Éco',nuit:'Nuit',absent:'Absent'};
  const clone = x => JSON.parse(JSON.stringify(x));
  const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stable = x => JSON.stringify(x, function(k,v){return v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v;});
  const formatTime = n => String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  function minutes(value, end=false) {
    const m=String(value).trim().match(/^(\d{1,2})(?::(\d{1,2}))?(?::00)?$/);
    if(!m)throw new Error('Saisissez une heure comme 7, 7:30 ou 07:00.');
    const hour=Number(m[1]),minute=Number(m[2]??0),n=hour*60+minute;
    if(minute>59 || hour>24 || n>1440 || (!end && n===1440))throw new Error('Heure invalide. 24:00 est uniquement une fin de plage.');
    return n;
  }
  function validate(schedule, sets={}) {
    const copy=clone(schedule);
    for(const day of DAYS){
      const blocks=copy[day] || [];
      blocks.sort((a,b)=>minutes(a.from)-minutes(b.from));
      let last=0;
      for(const b of blocks){
        const from=minutes(b.from),to=minutes(b.to,true);
        if(from>=to)throw new Error('La fin doit être après le début. Coupez les plages nocturnes à minuit.');
        if(from<last)throw new Error('Deux plages se chevauchent : '+LABELS[DAYS.indexOf(day)]+'.');
        if(!Object.hasOwn(PROFILES,b.data?.profil ?? 'confort')&&!Object.hasOwn(sets,b.data?.profil ?? 'confort'))throw new Error('Choisissez un jeu de températures valide pour chaque plage.');
        last=to;
        b.from=formatTime(from);b.to=formatTime(to);
        b.data={...b.data,profil:b.data?.profil ?? 'confort'};
      }
      copy[day]=blocks;
    }
    return copy;
  }
  class ChauffagePlanningCard extends HTMLElement {
    constructor(){super();this.attachShadow({mode:'open'});this.day='monday';this.index=0;this.dirty=false;this.setDirty=false;this.setId='';this.setDraft=null;this.busy=false;this.message='';}
    setConfig(config){if(!Array.isArray(config.schedules)||!config.schedules.length)throw new Error('Renseigner schedules : name et entity.');this.config=config;this.index=Math.max(0,config.schedules.findIndex(s=>s.entity===config.active_schedule));this.setId='';this.setDraft={name:'',temperatures:Object.fromEntries((config.rooms||[]).map(room=>[room.id,room.temperatures?.eco??17]))};this.ready=false;this.render();if(this._hass)this.load();}
    set hass(hass){this._hass=hass;if(this.config&&!this.ready&&!this.busy)this.load();}
    getCardSize(){return 8;}
    selectSet(id){this.setId=id;const saved=this.config.temperature_sets?.[id];this.setDraft=saved?clone(saved):{name:'',temperatures:Object.fromEntries((this.config.rooms||[]).map(room=>[room.id,room.temperatures?.eco??17]))};this.setDirty=false;this.render();}
    async saveSet(){
      if(this.busy||!this.setDraft)return;
      if(this.dirty){this.message='Enregistrez ou annulez d’abord les horaires.';this.render();return;}
      try{
        const name=this.setDraft.name.trim(),rooms=this.config.rooms||[];
        if(!name||name.length>80)throw new Error('Donnez un nom au jeu de températures.');
        if(!rooms.length)throw new Error('Ajoutez une pièce avant de créer un jeu.');
        const temperatures=Object.fromEntries(rooms.map(room=>[room.id,Number(this.setDraft.temperatures[room.id])]));
        if(Object.values(temperatures).some(value=>!Number.isFinite(value)||value<5||value>25||value*2!==Math.round(value*2)))throw new Error('Choisissez des températures de 5 à 25 °C par pas de 0,5 °C.');
        this.busy=true;this.message='Enregistrement du jeu…';this.render();
        await this._hass.callService('ma_maison_chauffage','command',{operation:'save_temperature_set',revision:this.config.revision,payload:{id:this.setId||null,name,temperatures}});
        this.setDirty=false;this.dispatchEvent(new CustomEvent('chauffage-temperature-set-saved',{bubbles:true,composed:true}));
      }catch(error){this.message=error.message||String(error);}
      finally{this.busy=false;this.render();}
    }
    async load(){
      if(this.busy)return;this.busy=true;this.message='Chargement…';this.render();
      try{
        const entity=this.config.schedules[this.index].entity;
        const [list,row]=await Promise.all([this._hass.callWS({type:'schedule/list'}),this._hass.callWS({type:'config/entity_registry/get',entity_id:entity})]);
        const item=row?.platform==='schedule'&&list.find(s=>s.id===row.unique_id);
        if(!item)throw new Error('Créez d’abord l’assistant Planning '+entity+' dans HA. Les plannings YAML ne sont pas modifiables ici.');
        this.original=clone(item);this.draft=clone(item);for(const d of DAYS)this.draft[d]??=[];
        this.dirty=false;this.message='Hors plage : Éco. Les températures sont propres à chaque pièce.';
      }catch(e){this.draft=null;this.message=e.message||String(e);}
      finally{this.ready=true;this.busy=false;this.render();}
    }
    async save(){
      if(this.busy||!this.draft)return;
      if(this.setDirty){this.message='Enregistrez d’abord le jeu de températures.';this.render();return;}
      let savedSuccessfully=false;
      try{
        const cleaned=validate(this.draft,this.config?.temperature_sets);
        this.busy=true;this.message='Enregistrement…';this.render();
        // Refuse stale writes if another user changed this schedule since loading.
        const list=await this._hass.callWS({type:'schedule/list'});
        const current=list.find(x=>x.id===this.original.id);
        if(!current || stable(current)!==stable(this.original))throw new Error('Ce planning a changé ailleurs. Rechargez-le avant de modifier à nouveau.');
        const {id,...values}=cleaned;
        const saved=await this._hass.callWS({type:'schedule/update',schedule_id:id,...values});
        this.original=clone(saved);this.draft=clone(saved);for(const d of DAYS)this.draft[d]??=[];
        this.dirty=false;this.message='Planning enregistré dans Home Assistant.';
        savedSuccessfully=true;
      }catch(e){this.message=e.message||String(e);}
      finally{this.busy=false;this.render();}
      if(savedSuccessfully)this.dispatchEvent(new CustomEvent('chauffage-planning-saved',{bubbles:true,composed:true}));
    }
    add(){
      const b=this.draft[this.day];let from=12*60;
      try {from=b.length?Math.min(1380,minutes(b[b.length-1].to,true)):360;}catch{}
      b.push({from:formatTime(from),to:formatTime(Math.min(1440,from+60)),data:{profil:'confort'}});this.dirty=true;this.render();
    }
    refreshTimeline(){
      const line=this.shadowRoot.querySelector('.timeline');if(!line)return;line.replaceChildren();
      for(const b of this.draft[this.day]){try{const f=minutes(b.from),t=minutes(b.to,true),p=b.data?.profil??'confort';if(t<=f||(!Object.hasOwn(PROFILES,p)&&!Object.hasOwn(this.config.temperature_sets||{},p)))continue;const span=document.createElement('span');span.className='segment '+(Object.hasOwn(PROFILES,p)?p:'custom');span.style.left=f/14.4+'%';span.style.width=(t-f)/14.4+'%';line.append(span);}catch{}}
      const save=this.shadowRoot.querySelector('#save');if(save)save.textContent='Enregistrer *';
    }
    render(){
      if(!this.config)return;
      const blocks=this.draft?.[this.day]||[],sets=this.config.temperature_sets||{},rooms=this.config.rooms||[];
      const setOptions={...PROFILES,...Object.fromEntries(Object.entries(sets).map(([id,item])=>[id,item.name]))};
      const disabled=this.busy?'disabled':'';
      this.shadowRoot.innerHTML=`<style>
        :host{display:block;color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family,system-ui,sans-serif)}
        *{box-sizing:border-box}ha-card{padding:20px;border-radius:22px}h2{margin:0 0 18px;font-size:23px}label{display:block;font-size:13px;margin-bottom:5px}
        select,input,button{font:inherit;color:var(--primary-text-color);background:var(--ha-card-background,var(--card-background-color));border:1px solid var(--divider-color);border-radius:10px;min-height:44px;padding:8px;max-width:100%}
        select,input{width:100%}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.days{display:flex;flex-wrap:wrap;gap:5px;margin:16px 0}.days button{flex:1;min-width:38px;padding:6px;font-size:12px}.days [aria-pressed=true]{background:#406bfa;color:white;border-color:#406bfa}
        .block{padding:16px;margin:12px 0;border:1px solid var(--divider-color);border-radius:16px}.hours{display:grid;grid-template-columns:1fr 1fr;gap:12px}.profile{display:grid;grid-template-columns:1fr auto;align-items:end;gap:12px;margin-top:10px}.block-rooms{margin-top:14px;padding-top:8px;border-top:1px solid var(--divider-color)}.block-room{display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:14px}.block-room strong{white-space:nowrap}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.primary{background:#406bfa;color:white;border-color:#406bfa}.status{font-size:13px;line-height:1.5;margin-top:14px;color:var(--secondary-text-color)}details{margin-top:18px}.copies{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.copies label{display:flex;align-items:center;gap:4px;margin:0}.copies input{width:20px;min-height:24px}.scale{display:flex;justify-content:space-between;font-size:11px;margin-top:16px}.timeline{height:24px;position:relative;background:var(--secondary-background-color);margin:4px 0 10px;border-radius:6px;overflow:hidden}.segment{position:absolute;height:100%;opacity:.8}.confort{background:#ef963c}.eco{background:#8fa7cb}.nuit{background:#6e69c6}.absent{background:#5eaf9d}.custom{background:#e5bb31}.set-editor{border-top:1px solid var(--divider-color);margin-top:24px;padding-top:18px}.set-editor h3{margin:0 0 8px}.set-room{display:grid;grid-template-columns:minmax(0,1fr) 95px;gap:10px;align-items:center;padding:7px 0}.set-room label{margin:0}
      </style><ha-card><h2>Mes plannings</h2>
        <label for="plan">Planning à modifier</label><select id="plan" ${disabled}>${this.config.schedules.map((s,i)=>`<option value="${i}" ${i===this.index?'selected':''}>${esc(s.name)}</option>`).join('')}</select>
        <div class="days" aria-label="Jour">${DAYS.map((d,i)=>`<button type="button" data-day="${d}" ${disabled} aria-label="${LABELS[i]}" aria-pressed="${this.day===d}">${LABELS[i].slice(0,3)}</button>`).join('')}</div>
        ${this.draft?`<strong>${LABELS[DAYS.indexOf(this.day)]}</strong><div class="scale"><span>00h</span><span>12h</span><span>24h</span></div><div class="timeline" aria-hidden="true">${blocks.map(b=>{try{const f=minutes(b.from),t=minutes(b.to,true),p=b.data?.profil??'confort';return t>f&&Object.hasOwn(setOptions,p)?`<span class="segment ${Object.hasOwn(PROFILES,p)?p:'custom'}" style="left:${f/14.4}%;width:${(t-f)/14.4}%"></span>`:'';}catch{return '';}}).join('')}</div>
        ${blocks.map((b,i)=>`<div class="block"><div class="hours"><div><label for="from-${i}">Début</label><input id="from-${i}" data-i="${i}" data-field="from" value="${esc(b.from.replace(/:00$/,'').length===5?b.from.slice(0,5):b.from)}" placeholder="7 ou 07:00" ${disabled}></div><div><label for="to-${i}">Fin (24:00 possible)</label><input id="to-${i}" data-i="${i}" data-field="to" value="${esc(b.to.length===8?b.to.slice(0,5):b.to)}" placeholder="8 ou 08:00" ${disabled}></div></div><div class="profile"><div><label for="profil-${i}">Jeu de températures</label><select id="profil-${i}" data-i="${i}" data-field="profil" ${disabled}>${!Object.hasOwn(setOptions,b.data?.profil??'confort')?'<option selected value="invalide">Jeu inconnu</option>':''}${Object.entries(setOptions).map(([v,label])=>`<option value="${esc(v)}" ${(b.data?.profil??'confort')===v?'selected':''}>${esc(label)}</option>`).join('')}</select></div><button type="button" data-delete="${i}" ${disabled} aria-label="Supprimer la plage ${i+1}">Supprimer</button></div><div class="block-rooms">${rooms.map(room=>`<div class="block-room"><span>${esc(room.name)}</span><strong>${esc(Object.hasOwn(PROFILES,b.data?.profil??'confort')?room.temperatures?.[b.data?.profil??'confort']:sets[b.data?.profil]?.temperatures?.[room.id]??room.temperatures?.eco??'—')} °C</strong></div>`).join('')}</div></div>`).join('')}
        <div class="actions"><button type="button" id="add" ${disabled}>+ Ajouter une plage</button></div>
        <details><summary>Copier cette journée</summary><div class="copies">${DAYS.filter(d=>d!==this.day).map(d=>`<label><input type="checkbox" value="${d}" ${disabled}>${LABELS[DAYS.indexOf(d)].slice(0,3)}</label>`).join('')}</div><button type="button" id="copy" ${disabled}>Remplacer les jours cochés</button></details>
        <div class="actions"><button type="button" class="primary" id="save" ${disabled}>Enregistrer${this.dirty?' *':''}</button><button type="button" id="reload" ${disabled}>${this.dirty?'Annuler les modifications':'Recharger'}</button></div>`:`<div class="actions"><button type="button" id="reload" ${disabled}>Réessayer</button></div>`}
        <section class="set-editor"><h3>Jeux de températures</h3><p>Créez autant de jeux que nécessaire. Un jeu donne une consigne à chaque pièce et peut servir sur plusieurs plages.</p><label for="set-select">Jeu à modifier</label><select id="set-select" ${disabled}><option value="">Nouveau jeu</option>${Object.entries(sets).map(([id,item])=>`<option value="${esc(id)}" ${id===this.setId?'selected':''}>${esc(item.name)}</option>`).join('')}</select><label for="set-name">Nom du jeu</label><input id="set-name" maxlength="80" value="${esc(this.setDraft?.name??'')}" ${disabled}>${rooms.map(room=>`<div class="set-room"><label for="set-room-${esc(room.id)}">${esc(room.name)}</label><input id="set-room-${esc(room.id)}" type="number" min="5" max="25" step="0.5" data-set-room="${esc(room.id)}" value="${esc(this.setDraft?.temperatures?.[room.id]??room.temperatures?.eco??17)}" ${disabled}></div>`).join('')}<div class="actions"><button type="button" class="primary" id="set-save" ${disabled}>Enregistrer le jeu${this.setDirty?' *':''}</button></div></section>
        <div class="status" role="status" aria-live="polite">${esc(this.message)}</div></ha-card>`;
      const q=s=>this.shadowRoot.querySelector(s);
      q('#plan').onchange=e=>{if(this.dirty||this.setDirty){e.target.value=this.index;this.message='Enregistrez ou annulez vos modifications avant de changer de planning.';this.render();return;}this.index=Number(e.target.value);this.load();};
      this.shadowRoot.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{this.day=b.dataset.day;this.render();});
      this.shadowRoot.querySelectorAll('[data-field]').forEach(e=>e.onchange=()=>{const b=this.draft[this.day][Number(e.dataset.i)];if(e.dataset.field==='profil'){b.data={...b.data,profil:e.value};this.dirty=true;this.render();return;}else{b[e.dataset.field]=e.value;try{b[e.dataset.field]=formatTime(minutes(e.value,e.dataset.field==='to'));e.value=b[e.dataset.field];this.message='';}catch(error){this.message=error.message;}}this.dirty=true;this.refreshTimeline();const status=q('.status');if(status)status.textContent=this.message;});
      this.shadowRoot.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{this.draft[this.day].splice(Number(b.dataset.delete),1);this.dirty=true;this.render();});
      if(q('#add'))q('#add').onclick=()=>this.add();
      if(q('#save'))q('#save').onclick=()=>this.save();
      if(q('#reload'))q('#reload').onclick=()=>this.load();
      if(q('#copy'))q('#copy').onclick=()=>{let n=0;this.shadowRoot.querySelectorAll('.copies input:checked').forEach(e=>{this.draft[e.value]=clone(this.draft[this.day]);n++;});if(n){this.dirty=true;this.message=`${n} jour(s) remplacé(s) dans le brouillon. Enregistrez pour appliquer.`;this.render();}};
      q('#set-select').onchange=e=>{if(this.setDirty){e.target.value=this.setId;this.message='Enregistrez le jeu avant d’en choisir un autre.';this.render();return;}this.selectSet(e.target.value);};
      q('#set-name').oninput=e=>{this.setDraft.name=e.target.value;this.setDirty=true;};
      this.shadowRoot.querySelectorAll('[data-set-room]').forEach(e=>e.onchange=()=>{this.setDraft.temperatures[e.dataset.setRoom]=Number(e.value);this.setDirty=true;});
      q('#set-save').onclick=()=>this.saveSet();
    }
  }
  if(!customElements.get('chauffage-planning-card'))customElements.define('chauffage-planning-card',ChauffagePlanningCard);
})();
