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
    constructor(){super();this.attachShadow({mode:'open'});this.day='monday';this.index=0;this.screen='choose';this.setsReturn='choose';this.deleteConfirm='';this.editIndex=-1;this.dirty=false;this.setDirty=false;this.setId='';this.setDraft=null;this.busy=false;this.message='';}
    setConfig(config){if(!Array.isArray(config.schedules)||!config.schedules.length)throw new Error('Renseigner schedules : name et entity.');this.config=config;this.index=Math.max(0,config.schedules.findIndex(s=>s.entity===config.active_schedule));this.screen='choose';this.setId='';this.setDraft={name:'',temperatures:Object.fromEntries((config.rooms||[]).map(room=>[room.id,room.temperatures?.eco??17]))};this.ready=false;this.render();if(this._hass)this.load();}
    set hass(hass){this._hass=hass;if(this.config&&!this.ready&&!this.busy)this.load();}
    getCardSize(){return 8;}
    selectSet(id){this.setId=id;const saved=this.config.temperature_sets?.[id];const builtIn=Object.hasOwn(PROFILES,id);const defaults=Object.fromEntries((this.config.rooms||[]).map(room=>[room.id,builtIn?room.temperatures?.[id]??room.temperatures?.eco??17:room.temperatures?.eco??17]));this.setDraft={name:builtIn?PROFILES[id]:saved?.name??'',temperatures:{...defaults,...saved?.temperatures}};this.setDirty=false;this.screen='set';this.render();}
    async saveSet(){
      if(this.busy||!this.setDraft)return;
      if(this.dirty){this.message='Enregistrez ou annulez d’abord les horaires.';this.render();return;}
      try{
        const builtIn=Object.hasOwn(PROFILES,this.setId),name=this.setDraft.name.trim(),rooms=this.config.rooms||[];
        if(!builtIn&&(!name||name.length>80))throw new Error('Donnez un nom au jeu de températures.');
        if(!rooms.length)throw new Error('Ajoutez une pièce avant de créer un jeu.');
        const temperatures=Object.fromEntries(rooms.map(room=>[room.id,Number(this.setDraft.temperatures[room.id])]));
        if(Object.values(temperatures).some(value=>!Number.isFinite(value)||value<5||value>25||value*2!==Math.round(value*2)))throw new Error('Choisissez des températures de 5 à 25 °C par pas de 0,5 °C.');
        this.busy=true;this.message='Enregistrement du jeu…';this.render();
        await this._hass.callService('ma_maison_chauffage','command',{operation:builtIn?'save_profile_temperatures':'save_temperature_set',revision:this.config.revision,payload:builtIn?{profile:this.setId,temperatures}:{id:this.setId||null,name,temperatures}});
        this.setDirty=false;this.screen='sets';this.message='Jeu de températures enregistré.';this.dispatchEvent(new CustomEvent('chauffage-temperature-set-saved',{bubbles:true,composed:true}));
      }catch(error){this.message=error.message||String(error);}
      finally{this.busy=false;this.render();}
    }
    async removeSet(id){
      if(this.busy||!this.config.temperature_sets?.[id])return;
      try{
        this.busy=true;this.message='Vérification des plannings…';this.render();
        const list=await this._hass.callWS({type:'schedule/list'});
        if(!Array.isArray(list))throw new Error('Impossible de vérifier les plannings. Réessayez plus tard.');
        if(list.some(schedule=>DAYS.some(day=>(schedule[day]||[]).some(block=>block.data?.profil===id))))throw new Error('Ce jeu est utilisé dans un planning. Remplacez-le dans les plages avant de le supprimer.');
        await this._hass.callService('ma_maison_chauffage','command',{operation:'remove_temperature_set',revision:this.config.revision,payload:{id}});
        this.deleteConfirm='';this.message='Jeu de températures supprimé.';
        this.dispatchEvent(new CustomEvent('chauffage-temperature-set-removed',{bubbles:true,composed:true}));
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
        this.dirty=false;this.message='';
      }catch(e){this.draft=null;this.message=e.message||String(e);}
      finally{this.ready=true;this.busy=false;this.render();}
    }
    async save(){
      if(this.busy||!this.draft)return;
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
      if(savedSuccessfully){
        if(this.setDirty){this.message='Horaires enregistrés. Enregistrez maintenant le jeu de températures.';this.render();}
        else this.dispatchEvent(new CustomEvent('chauffage-planning-saved',{bubbles:true,composed:true}));
      }
    }
    add(){
      const blocks=this.draft[this.day];
      let ranges;
      try{ranges=blocks.map(block=>[minutes(block.from),minutes(block.to,true)]);}catch(error){this.message=error.message;this.render();return;}
      const candidates=[...Array.from({length:36},(_,i)=>360+i*30),...Array.from({length:12},(_,i)=>i*30)];
      const from=candidates.find(start=>start+60<=1440&&ranges.every(([left,right])=>start+60<=left||start>=right))??720;
      this.dirtyBeforeAdd=this.dirty;
      blocks.push({from:formatTime(from),to:formatTime(from+60),data:{profil:'confort'}});this.editIndex=blocks.length-1;this.newBlock=true;this.screen='block';this.dirty=true;this.render();
    }
    render(){
      if(!this.config)return;
      const rooms=this.config.rooms||[],sets=this.config.temperature_sets||{};
      const names={...PROFILES,...Object.fromEntries(Object.entries(sets).map(([id,item])=>[id,item.name]))};
      const blocks=this.draft?.[this.day]||[];
      const disabled=this.busy?'disabled':'';
      const temperature=(room,profile)=>Object.hasOwn(PROFILES,profile)?room.temperatures?.[profile]:sets[profile]?.temperatures?.[room.id]??room.temperatures?.eco;
      const roomRows=profile=>`<div class="room-list">${rooms.map(room=>`<div class="room-row"><span>${esc(room.name)}</span><strong>${esc(temperature(room,profile)??'—')} °C</strong></div>`).join('')}</div>`;
      const palette=['#f4a340','#6887ed','#4aaf93','#dc8c55','#aa79dc','#4baec9'];
      const profileColor=profile=>({confort:'#f4a340',eco:'#73b69a',nuit:'#6487e9',absent:'#97a0b1'})[profile]||palette[[...profile].reduce((sum,char)=>sum+char.charCodeAt(0),0)%palette.length];
      const profileSymbol=profile=>({confort:'⌂',eco:'♧',nuit:'☾',absent:'○'})[profile]||String(names[profile]||'?').trim().slice(0,1).toUpperCase();
      const badge=profile=>`<span class="profile-badge" style="--profile-color:${profileColor(profile)}" aria-hidden="true">${esc(profileSymbol(profile))}</span>`;
      const timeline=`<div class="day-scale" aria-hidden="true"><span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>24h</span></div><div class="day-track" aria-label="Plages de la journée">${blocks.map((block,i)=>{try{const start=minutes(block.from),end=minutes(block.to,true),profile=block.data?.profil??'confort';return `<button type="button" class="time-segment" data-open-block="${i}" aria-label="${esc(block.from.slice(0,5))} à ${esc(block.to.slice(0,5))} : ${esc(names[profile]||'Jeu inconnu')}" style="left:${start/14.4}%;width:${(end-start)/14.4}%;--profile-color:${profileColor(profile)}" ${disabled}></button>`;}catch{return '';}}).join('')}</div>`;
      const back='<button type="button" id="back" class="back">← Retour</button>';
      const picker=`<label for="plan">Planning</label><select id="plan" ${disabled}>${this.config.schedules.map((item,i)=>`<option value="${i}" ${i===this.index?'selected':''}>${esc(item.name)}</option>`).join('')}</select>`;
      const dayPicker=`<div class="days" aria-label="Jour">${DAYS.map((day,i)=>`<button type="button" data-day="${day}" aria-pressed="${this.screen==='overview'&&this.day===day}" ${disabled}>${LABELS[i].slice(0,3)}</button>`).join('')}</div>`;
      let body='';
      if(this.screen==='choose'){
        body=`<h2>Mes plannings</h2>${picker}<p class="hint">Choisissez un jour pour voir ses plages horaires.</p>${dayPicker}<button type="button" id="sets-open" class="sets-open" ${disabled}>Tous les jeux de températures ›</button>`;
      }else if(this.screen==='sets'){
        body=`${back}<h2>Tous les jeux de températures</h2><p class="hint">Chaque jeu fixe une température par pièce et peut servir dans plusieurs plannings.</p><h3>Jeux intégrés</h3>${Object.entries(PROFILES).map(([id,name])=>`<div class="set-entry"><div class="set-title">${badge(id)}<strong>${esc(name)}</strong></div>${roomRows(id)}<div class="set-actions"><button type="button" data-open-set="${esc(id)}" ${disabled}>Modifier les températures</button></div></div>`).join('')}<h3>Mes jeux</h3>${Object.entries(sets).map(([id,item])=>`<div class="set-entry"><div class="set-title">${badge(id)}<strong>${esc(item.name)}</strong></div>${roomRows(id)}<div class="set-actions"><button type="button" data-open-set="${esc(id)}" ${disabled}>Modifier les températures</button><button type="button" data-delete-set="${esc(id)}" ${disabled}>Supprimer</button></div>${this.deleteConfirm===id?`<div class="delete-confirm"><p>Supprimer « ${esc(item.name)} » ?</p><button type="button" data-confirm-delete="${esc(id)}" ${disabled}>Confirmer la suppression</button><button type="button" id="cancel-delete" ${disabled}>Annuler</button></div>`:''}</div>`).join('')||'<p class="hint">Aucun jeu personnalisé.</p>'}<button type="button" class="add" id="new-set" ${disabled}>+ Ajouter un jeu de températures</button><p class="hint">Les jeux intégrés ne peuvent pas être supprimés.</p>`;
      }else if(this.screen==='block'&&this.draft){
        const block=blocks[this.editIndex];
        if(!block){this.screen='overview';return this.render();}
        const profile=block.data?.profil??'confort';
        body=`${back}<h2>${this.newBlock?'Ajouter une plage horaire':'Modifier une plage horaire'}</h2>
          <div class="field-row"><div><label for="from">Début</label><input id="from" inputmode="text" value="${esc(block.from)}" placeholder="6:30" ${disabled}></div><div><label for="to">Fin</label><input id="to" inputmode="text" value="${esc(block.to)}" placeholder="8" ${disabled}></div></div><p class="hint">Exemples : 6 = 06:00 ; 6:30 = 06:30.</p>
          <h3>Jeu de températures</h3><div class="choices">${Object.entries(names).map(([id,name])=>`<button type="button" data-profile="${esc(id)}" class="choice ${profile===id?'chosen':''}" aria-pressed="${profile===id}" ${disabled}>${badge(id)}<strong>${esc(name)}</strong><span class="choice-check" aria-hidden="true">${profile===id?'✓':'○'}</span></button>`).join('')}</div>
          ${roomRows(profile)}<div class="actions"><button type="button" class="primary" id="block-done" ${disabled}>Valider la plage</button><button type="button" id="block-delete" ${disabled}>${this.newBlock?'Annuler':'Supprimer la plage'}</button></div><p class="hint">${this.newBlock?'Si une plage existe déjà à ces heures, elle sera conservée avant et après la nouvelle plage. ':''}Après validation, enregistrez le planning pour appliquer les horaires.</p>`;
      }else if(this.screen==='set'){
        body=`${back}<h2>${this.setId?'Modifier les températures':'Nouveau jeu de températures'}</h2>${Object.hasOwn(PROFILES,this.setId)?`<div class="set-title">${badge(this.setId)}<strong>${esc(PROFILES[this.setId])}</strong></div>`:`<label for="set-name">Nom du jeu</label><input id="set-name" maxlength="80" value="${esc(this.setDraft?.name??'')}" ${disabled}>`}
          <h3>Température des pièces</h3><p class="hint">Ces valeurs s’appliquent à toutes les plages et à tous les plannings qui utilisent ce jeu.</p>
          ${rooms.map(room=>{const value=this.setDraft?.temperatures?.[room.id]??room.temperatures?.eco??17;return `<div class="set-room"><div class="set-room-head"><label for="set-room-${esc(room.id)}">${esc(room.name)}</label><input id="set-room-${esc(room.id)}" type="number" min="5" max="25" step="0.5" data-set-room="${esc(room.id)}" value="${esc(value)}" ${disabled}><span>°C</span></div><input type="range" min="5" max="25" step="0.5" data-range-room="${esc(room.id)}" aria-label="Température de ${esc(room.name)}" style="--fill:${(Number(value)-5)*5}%" value="${esc(value)}" ${disabled}><div class="range-scale"><span>5 °C</span><span>25 °C</span></div></div>`;}).join('')}
          <div class="actions"><button type="button" class="primary" id="set-save" ${disabled}>Enregistrer le jeu</button><button type="button" id="set-cancel" ${disabled}>Annuler</button></div>`;
      }else{
        body=`${back}<h2>${esc(this.config.schedules[this.index].name)}</h2>${picker}${dayPicker}
          ${this.draft?`<h3>${LABELS[DAYS.indexOf(this.day)]}</h3>${blocks.length?timeline:''}${blocks.length?blocks.map((block,i)=>{const profile=block.data?.profil??'confort';return `<button type="button" class="period" data-open-block="${i}" style="--profile-color:${profileColor(profile)}" ${disabled}><span class="period-time">◷ ${esc(block.from.slice(0,5))} – ${esc(block.to.slice(0,5))}</span><span class="period-title">${badge(profile)}<strong class="period-name">${esc(names[profile]||'Jeu inconnu')}</strong><span aria-hidden="true">›</span></span>${roomRows(profile)}</button>`;}).join(''):'<p class="hint">Aucune plage : température Éco toute la journée.</p>'}
          <button type="button" class="fab" id="add" aria-label="Ajouter une plage horaire" title="Ajouter une plage horaire" ${disabled}>+</button>
          <details><summary>Copier cette journée</summary><div class="copies">${DAYS.filter(day=>day!==this.day).map(day=>`<label><input type="checkbox" value="${day}" ${disabled}>${LABELS[DAYS.indexOf(day)].slice(0,3)}</label>`).join('')}</div><button type="button" id="copy" ${disabled}>Remplacer les jours cochés</button><div class="actions"><button type="button" id="copy-weekdays" ${disabled}>Appliquer aussi du lundi au vendredi</button></div></details>
          <div class="actions"><button type="button" class="primary" id="save" ${disabled}>Enregistrer le planning${this.dirty?' *':''}</button><button type="button" id="reload" ${disabled}>${this.dirty?'Annuler les modifications':'Recharger'}</button></div>`:`<button type="button" id="reload" ${disabled}>Réessayer</button>`}
          <button type="button" id="sets-open" class="sets-open" ${disabled}>Tous les jeux de températures ›</button>`;
      }
      this.shadowRoot.innerHTML=`<style>
        :host{display:block;color:var(--primary-text-color);font-family:system-ui,sans-serif}*{box-sizing:border-box}ha-card{padding:20px;border-radius:22px}h2{margin:8px 0 20px;font-size:24px}h3{margin:22px 0 12px;font-size:19px}label{display:block;font-size:14px;margin:10px 0 6px}
        select,input,button{font:inherit;color:inherit;background:var(--ha-card-background,var(--card-background-color));border:1px solid var(--divider-color);border-radius:12px;min-height:44px;padding:9px;max-width:100%}select,input{width:100%}button{cursor:pointer}button:disabled{opacity:.5}.primary,.add{background:#406bfa;color:white;border-color:#406bfa;font-weight:650}.add{width:100%;margin-top:12px}.back{border:0;background:var(--secondary-background-color);margin-bottom:8px}.days{display:flex;gap:4px;margin:18px 0;overflow-x:auto}.days button{flex:1;min-width:40px;padding:6px}.days [aria-pressed=true]{background:#406bfa;color:white;border-color:#406bfa}
        .period{display:block;width:100%;text-align:left;padding:16px;margin:12px 0;border-radius:16px}.period-time{display:block;color:var(--secondary-text-color);font-size:14px}.period-name{display:flex;justify-content:space-between;font-size:20px;margin:5px 0 12px}.room-list{border-top:1px solid var(--divider-color);padding-top:7px}.room-row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:15px}.room-row strong{white-space:nowrap}.fab{display:grid;place-items:center;width:64px;height:64px;min-height:64px;margin:14px 0 14px auto;border-radius:50%;background:#406bfa;color:white;border-color:#406bfa;font-size:40px;line-height:1}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.choices{display:grid;grid-template-columns:1fr 1fr;gap:8px}.choice{text-align:left}.choice.chosen{background:#406bfa;color:white;border-color:#406bfa}.set-room{display:grid;grid-template-columns:minmax(0,1fr) 95px;gap:12px;align-items:center;padding:8px 0}.set-room label{margin:0}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.hint,.status{font-size:13px;line-height:1.5;color:var(--secondary-text-color)}.status{margin-top:16px}.sets-open{width:100%;text-align:left;margin-top:20px}.set-choice{display:flex;justify-content:space-between;align-items:center;width:100%;margin:7px 0}.copies{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}.copies label{display:flex;align-items:center;gap:5px}.copies input{width:18px;min-height:20px}details{margin-top:18px}
        .day-scale{display:flex;justify-content:space-between;color:var(--secondary-text-color);font-size:11px;margin-top:14px}.day-track{position:relative;height:34px;margin:5px 0 20px;border-radius:10px;overflow:hidden;background:#dfe8f4;background-image:linear-gradient(to right,#a9b9cb55 1px,transparent 1px);background-size:25% 100%}.time-segment{position:absolute;top:0;height:34px;min-height:34px;border:0;border-right:2px solid var(--ha-card-background,var(--card-background-color));border-radius:0;padding:0;background:var(--profile-color)}.time-segment:focus-visible{outline:3px solid #243ac2;outline-offset:-3px}.profile-badge{display:inline-grid;place-items:center;flex:none;width:34px;height:34px;border-radius:50%;background:var(--profile-color);color:white;font-size:21px;font-weight:700}.period{border-left:5px solid var(--profile-color)}.period-title{display:flex;align-items:center;gap:10px;margin:8px 0 10px}.period-title .period-name{display:block;flex:1;margin:0;font-size:19px}.choices{display:flex;flex-direction:column}.choice{display:flex;align-items:center;gap:12px;text-align:left;padding:10px}.choice strong{flex:1}.choice.chosen{background:color-mix(in srgb,#406bfa 12%,var(--ha-card-background,var(--card-background-color)));color:var(--primary-text-color);border:2px solid #406bfa}.choice-check{font-size:21px;color:#406bfa}.set-choice{justify-content:flex-start;gap:10px}.set-choice strong{flex:1;text-align:left}.set-room{display:block;padding:16px;margin:12px 0;border:1px solid var(--divider-color);border-radius:16px}.set-room-head{display:flex;align-items:center;gap:5px}.set-room-head label{flex:1}.set-room-head input{width:76px;text-align:right;font-weight:700}.set-room input[type=range]{display:block;width:100%;min-height:34px;height:34px;margin:12px 0 0;padding:0;border:0;accent-color:#406bfa;background:linear-gradient(to right,#406bfa var(--fill),#e5edff var(--fill));border-radius:20px;appearance:none}.set-room input[type=range]::-webkit-slider-thumb{appearance:none;width:23px;height:23px;border:3px solid white;border-radius:50%;background:#406bfa;box-shadow:0 1px 6px #0004}.range-scale{display:flex;justify-content:space-between;color:var(--secondary-text-color);font-size:11px}
        .set-entry{padding:14px;margin:12px 0;border:1px solid var(--divider-color);border-radius:16px}.set-title{display:flex;align-items:center;gap:10px;margin-bottom:10px}.set-title strong{font-size:17px}.set-actions{display:flex;gap:8px;margin-top:12px}.delete-confirm{padding:12px;margin-top:12px;border-radius:12px;background:var(--secondary-background-color)}.delete-confirm p{margin:0 0 10px}.delete-confirm button{margin:0 8px 4px 0}.delete-confirm [data-confirm-delete]{color:#b3261e;border-color:#b3261e}
      </style><ha-card>${body}${this.message?`<div class="status" role="status" aria-live="polite">${esc(this.message)}</div>`:''}</ha-card>`;
      const q=selector=>this.shadowRoot.querySelector(selector);
      if(q('#back'))q('#back').onclick=()=>{if(this.screen==='set'&&this.setDirty){this.message='Enregistrez le jeu ou annulez ses modifications.';this.render();return;}if(this.screen==='block'&&this.newBlock){this.draft[this.day].splice(this.editIndex,1);this.dirty=this.dirtyBeforeAdd;this.newBlock=false;}this.screen=this.screen==='overview'?'choose':this.screen==='set'?'sets':this.screen==='sets'?this.setsReturn:'overview';this.render();};
      if(q('#plan'))q('#plan').onchange=e=>{if(this.dirty||this.setDirty){e.target.value=this.index;this.message='Enregistrez ou annulez vos modifications avant de changer de planning.';this.render();return;}this.index=Number(e.target.value);this.screen='choose';this.load();};
      this.shadowRoot.querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>{this.day=button.dataset.day;this.screen='overview';this.render();});
      this.shadowRoot.querySelectorAll('[data-open-block]').forEach(button=>button.onclick=()=>{this.editIndex=Number(button.dataset.openBlock);this.newBlock=false;this.screen='block';this.render();});
      if(q('#sets-open'))q('#sets-open').onclick=()=>{if(this.dirty){this.message='Enregistrez ou annulez d’abord les horaires.';this.render();return;}this.setsReturn=this.screen;this.deleteConfirm='';this.screen='sets';this.render();};
      this.shadowRoot.querySelectorAll('[data-open-set]').forEach(button=>button.onclick=()=>{if(this.dirty){this.message='Enregistrez ou annulez d’abord les horaires.';this.render();return;}this.selectSet(button.dataset.openSet);});
      if(q('#new-set'))q('#new-set').onclick=()=>{if(this.dirty){this.message='Enregistrez ou annulez d’abord les horaires.';this.render();return;}this.selectSet('');};
      this.shadowRoot.querySelectorAll('[data-delete-set]').forEach(button=>button.onclick=()=>{this.deleteConfirm=button.dataset.deleteSet;this.message='';this.render();});
      this.shadowRoot.querySelectorAll('[data-confirm-delete]').forEach(button=>button.onclick=()=>this.removeSet(button.dataset.confirmDelete));
      if(q('#cancel-delete'))q('#cancel-delete').onclick=()=>{this.deleteConfirm='';this.render();};
      if(q('#add'))q('#add').onclick=()=>this.add();
      if(q('#save'))q('#save').onclick=()=>this.save();
      if(q('#reload'))q('#reload').onclick=()=>this.load();
      if(q('#copy'))q('#copy').onclick=()=>{let count=0;this.shadowRoot.querySelectorAll('.copies input:checked').forEach(input=>{this.draft[input.value]=clone(this.draft[this.day]);count++;});if(count){this.dirty=true;this.message=`${count} jour(s) remplacé(s). Enregistrez le planning.`;this.render();}};
      if(q('#copy-weekdays'))q('#copy-weekdays').onclick=()=>{for(const day of DAYS.slice(0,5))this.draft[day]=clone(this.draft[this.day]);this.dirty=true;this.message='Journée copiée du lundi au vendredi. Enregistrez le planning pour appliquer.';this.render();};
      if(q('#from'))q('#from').onchange=e=>{blocks[this.editIndex].from=e.target.value;this.dirty=true;};
      if(q('#to'))q('#to').onchange=e=>{blocks[this.editIndex].to=e.target.value;this.dirty=true;};
      this.shadowRoot.querySelectorAll('[data-profile]').forEach(button=>button.onclick=()=>{blocks[this.editIndex].data={...blocks[this.editIndex].data,profil:button.dataset.profile};this.dirty=true;this.render();});
      if(q('#block-done'))q('#block-done').onclick=()=>{
        try{
          const block=blocks[this.editIndex],from=minutes(block.from),to=minutes(block.to,true);
          if(to<=from)throw new Error('La fin doit être après le début.');
          block.from=formatTime(from);block.to=formatTime(to);
          if(this.newBlock){
            const adjusted=[];
            for(const [i,existing] of blocks.entries()){
              if(i===this.editIndex)continue;
              const left=minutes(existing.from),right=minutes(existing.to,true);
              if(right<=from||left>=to){adjusted.push(existing);continue;}
              if(left<from)adjusted.push({...existing,to:formatTime(from)});
              if(right>to)adjusted.push({...existing,from:formatTime(to)});
            }
            adjusted.push(block);
            adjusted.sort((a,b)=>minutes(a.from)-minutes(b.from));
            this.draft[this.day]=adjusted;this.newBlock=false;
          }else{
            const sorted=[...blocks].sort((a,b)=>minutes(a.from)-minutes(b.from));
            if(sorted.some((item,i)=>i>0&&minutes(item.from)<minutes(sorted[i-1].to,true)))throw new Error('Cette plage chevauche une autre plage.');
          }
          this.screen='overview';this.message='Plage prête. Enregistrez le planning pour l’appliquer.';this.render();
        }catch(error){this.message=error.message;this.render();}
      };
      if(q('#block-delete'))q('#block-delete').onclick=()=>{blocks.splice(this.editIndex,1);this.dirty=this.newBlock?this.dirtyBeforeAdd:true;this.newBlock=false;this.screen='overview';this.render();};
      if(q('#set-name'))q('#set-name').oninput=e=>{this.setDraft.name=e.target.value;this.setDirty=true;};
      const setTemperature=(roomId,value)=>{
        this.setDraft.temperatures[roomId]=Number(value);this.setDirty=true;
        const number=[...this.shadowRoot.querySelectorAll('[data-set-room]')].find(input=>input.dataset.setRoom===roomId);
        const slider=[...this.shadowRoot.querySelectorAll('[data-range-room]')].find(input=>input.dataset.rangeRoom===roomId);
        if(number&&number.value!==String(value))number.value=value;
        if(slider){slider.value=value;slider.style.setProperty('--fill',`${(Number(value)-5)*5}%`);}
      };
      this.shadowRoot.querySelectorAll('[data-set-room]').forEach(input=>input.onchange=()=>setTemperature(input.dataset.setRoom,input.value));
      this.shadowRoot.querySelectorAll('[data-range-room]').forEach(input=>input.oninput=()=>setTemperature(input.dataset.rangeRoom,input.value));
      if(q('#set-save'))q('#set-save').onclick=()=>this.saveSet();
      if(q('#set-cancel'))q('#set-cancel').onclick=()=>{this.setDirty=false;this.screen='sets';this.render();};
    }
  }
  if(!customElements.get('chauffage-planning-card'))customElements.define('chauffage-planning-card',ChauffagePlanningCard);
})();

