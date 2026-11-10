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
    constructor(){super();this.attachShadow({mode:'open'});this.day='monday';this.index=0;this.screen='choose';this.editIndex=-1;this.dirty=false;this.setDirty=false;this.setId='';this.setDraft=null;this.busy=false;this.message='';}
    setConfig(config){if(!Array.isArray(config.schedules)||!config.schedules.length)throw new Error('Renseigner schedules : name et entity.');this.config=config;this.index=Math.max(0,config.schedules.findIndex(s=>s.entity===config.active_schedule));this.screen='choose';this.setId='';this.setDraft={name:'',temperatures:Object.fromEntries((config.rooms||[]).map(room=>[room.id,room.temperatures?.eco??17]))};this.ready=false;this.render();if(this._hass)this.load();}
    set hass(hass){this._hass=hass;if(this.config&&!this.ready&&!this.busy)this.load();}
    getCardSize(){return 8;}
    selectSet(id){this.setId=id;const saved=this.config.temperature_sets?.[id];this.setDraft=saved?clone(saved):{name:'',temperatures:Object.fromEntries((this.config.rooms||[]).map(room=>[room.id,room.temperatures?.eco??17]))};this.setDirty=false;this.screen='set';this.render();}
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
      const from=candidates.find(start=>start+60<=1440&&ranges.every(([left,right])=>start+60<=left||start>=right));
      if(from===undefined){this.message='La journée est déjà remplie. Modifiez ou supprimez une plage avant d’en ajouter une.';this.render();return;}
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
      const back='<button type="button" id="back" class="back">← Retour</button>';
      const picker=`<label for="plan">Planning</label><select id="plan" ${disabled}>${this.config.schedules.map((item,i)=>`<option value="${i}" ${i===this.index?'selected':''}>${esc(item.name)}</option>`).join('')}</select>`;
      const dayPicker=`<div class="days" aria-label="Jour">${DAYS.map((day,i)=>`<button type="button" data-day="${day}" aria-pressed="${this.screen==='overview'&&this.day===day}" ${disabled}>${LABELS[i].slice(0,3)}</button>`).join('')}</div>`;
      let body='';
      if(this.screen==='choose'){
        body=`<h2>Mes plannings</h2>${picker}<p class="hint">Choisissez un jour pour voir ses plages horaires.</p>${dayPicker}`;
      }else if(this.screen==='sets'){
        body=`${back}<h2>Jeux de températures</h2><p class="hint">Chaque jeu définit une température pour chaque pièce. Il peut être utilisé dans plusieurs plages du planning.</p>${Object.entries(sets).map(([id,item])=>`<button type="button" class="set-choice" data-open-set="${esc(id)}" ${disabled}><strong>${esc(item.name)}</strong><span>Modifier ›</span></button>`).join('')}<button type="button" class="add" id="new-set" ${disabled}>+ Créer un jeu</button>`;
      }else if(this.screen==='block'&&this.draft){
        const block=blocks[this.editIndex];
        if(!block){this.screen='overview';return this.render();}
        const profile=block.data?.profil??'confort';
        body=`${back}<h2>${this.newBlock?'Ajouter une plage horaire':'Modifier une plage horaire'}</h2>
          <div class="field-row"><div><label for="from">Début</label><input id="from" value="${esc(block.from)}" placeholder="07:00" ${disabled}></div><div><label for="to">Fin</label><input id="to" value="${esc(block.to)}" placeholder="24:00" ${disabled}></div></div>
          <h3>Jeu de températures</h3><div class="choices">${Object.entries(names).map(([id,name])=>`<button type="button" data-profile="${esc(id)}" class="choice ${profile===id?'chosen':''}" aria-pressed="${profile===id}" ${disabled}>${esc(name)}</button>`).join('')}</div>
          ${roomRows(profile)}<div class="actions"><button type="button" class="primary" id="block-done" ${disabled}>Valider la plage</button><button type="button" id="block-delete" ${disabled}>Supprimer la plage</button></div><p class="hint">Après validation, enregistrez le planning pour appliquer les horaires.</p>`;
      }else if(this.screen==='set'){
        body=`${back}<h2>${this.setId?'Modifier les températures':'Nouveau jeu de températures'}</h2><label for="set-name">Nom du jeu</label><input id="set-name" maxlength="80" value="${esc(this.setDraft?.name??'')}" ${disabled}>
          <h3>Température des pièces</h3><p class="hint">Ces valeurs s’appliquent à toutes les plages qui utilisent ce jeu.</p>
          ${rooms.map(room=>`<div class="set-room"><label for="set-room-${esc(room.id)}">${esc(room.name)}</label><input id="set-room-${esc(room.id)}" type="number" min="5" max="25" step="0.5" data-set-room="${esc(room.id)}" value="${esc(this.setDraft?.temperatures?.[room.id]??room.temperatures?.eco??17)}" ${disabled}></div>`).join('')}
          <div class="actions"><button type="button" class="primary" id="set-save" ${disabled}>Enregistrer le jeu</button><button type="button" id="set-cancel" ${disabled}>Annuler</button></div>`;
      }else{
        body=`${back}<h2>${esc(this.config.schedules[this.index].name)}</h2>${picker}${dayPicker}
          ${this.draft?`<h3>${LABELS[DAYS.indexOf(this.day)]}</h3>${blocks.length?blocks.map((block,i)=>{const profile=block.data?.profil??'confort';return `<button type="button" class="period" data-open-block="${i}" ${disabled}><span class="period-time">◷ ${esc(block.from.slice(0,5))} – ${esc(block.to.slice(0,5))}</span><strong class="period-name">${esc(names[profile]||'Jeu inconnu')} <span aria-hidden="true">›</span></strong>${roomRows(profile)}</button>`;}).join(''):'<p class="hint">Aucune plage : température Éco toute la journée.</p>'}
          <button type="button" class="fab" id="add" aria-label="Ajouter une plage horaire" title="Ajouter une plage horaire" ${disabled}>+</button>
          <details><summary>Copier cette journée</summary><div class="copies">${DAYS.filter(day=>day!==this.day).map(day=>`<label><input type="checkbox" value="${day}" ${disabled}>${LABELS[DAYS.indexOf(day)].slice(0,3)}</label>`).join('')}</div><button type="button" id="copy" ${disabled}>Remplacer les jours cochés</button><div class="actions"><button type="button" id="copy-weekdays" ${disabled}>Appliquer aussi du lundi au vendredi</button></div></details>
          <div class="actions"><button type="button" class="primary" id="save" ${disabled}>Enregistrer le planning${this.dirty?' *':''}</button><button type="button" id="reload" ${disabled}>${this.dirty?'Annuler les modifications':'Recharger'}</button></div>`:`<button type="button" id="reload" ${disabled}>Réessayer</button>`}
          <button type="button" id="sets-open" class="sets-open" ${disabled}>Jeux de températures ›</button>`;
      }
      this.shadowRoot.innerHTML=`<style>
        :host{display:block;color:var(--primary-text-color);font-family:system-ui,sans-serif}*{box-sizing:border-box}ha-card{padding:20px;border-radius:22px}h2{margin:8px 0 20px;font-size:24px}h3{margin:22px 0 12px;font-size:19px}label{display:block;font-size:14px;margin:10px 0 6px}
        select,input,button{font:inherit;color:inherit;background:var(--ha-card-background,var(--card-background-color));border:1px solid var(--divider-color);border-radius:12px;min-height:44px;padding:9px;max-width:100%}select,input{width:100%}button{cursor:pointer}button:disabled{opacity:.5}.primary,.add{background:#406bfa;color:white;border-color:#406bfa;font-weight:650}.add{width:100%;margin-top:12px}.back{border:0;background:var(--secondary-background-color);margin-bottom:8px}.days{display:flex;gap:4px;margin:18px 0;overflow-x:auto}.days button{flex:1;min-width:40px;padding:6px}.days [aria-pressed=true]{background:#406bfa;color:white;border-color:#406bfa}
        .period{display:block;width:100%;text-align:left;padding:16px;margin:12px 0;border-radius:16px}.period-time{display:block;color:var(--secondary-text-color);font-size:14px}.period-name{display:flex;justify-content:space-between;font-size:20px;margin:5px 0 12px}.room-list{border-top:1px solid var(--divider-color);padding-top:7px}.room-row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:15px}.room-row strong{white-space:nowrap}.fab{display:grid;place-items:center;width:64px;height:64px;min-height:64px;margin:14px 0 14px auto;border-radius:50%;background:#406bfa;color:white;border-color:#406bfa;font-size:40px;line-height:1}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.choices{display:grid;grid-template-columns:1fr 1fr;gap:8px}.choice{text-align:left}.choice.chosen{background:#406bfa;color:white;border-color:#406bfa}.set-room{display:grid;grid-template-columns:minmax(0,1fr) 95px;gap:12px;align-items:center;padding:8px 0}.set-room label{margin:0}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.hint,.status{font-size:13px;line-height:1.5;color:var(--secondary-text-color)}.status{margin-top:16px}.sets-open{width:100%;text-align:left;margin-top:20px}.set-choice{display:flex;justify-content:space-between;align-items:center;width:100%;margin:7px 0}.copies{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}.copies label{display:flex;align-items:center;gap:5px}.copies input{width:18px;min-height:20px}details{margin-top:18px}
      </style><ha-card>${body}${this.message?`<div class="status" role="status" aria-live="polite">${esc(this.message)}</div>`:''}</ha-card>`;
      const q=selector=>this.shadowRoot.querySelector(selector);
      if(q('#back'))q('#back').onclick=()=>{if(this.screen==='set'&&this.setDirty){this.message='Enregistrez le jeu ou annulez ses modifications.';this.render();return;}this.screen=this.screen==='overview'?'choose':this.screen==='set'?'sets':'overview';this.render();};
      if(q('#plan'))q('#plan').onchange=e=>{if(this.dirty||this.setDirty){e.target.value=this.index;this.message='Enregistrez ou annulez vos modifications avant de changer de planning.';this.render();return;}this.index=Number(e.target.value);this.screen='choose';this.load();};
      this.shadowRoot.querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>{this.day=button.dataset.day;this.screen='overview';this.render();});
      this.shadowRoot.querySelectorAll('[data-open-block]').forEach(button=>button.onclick=()=>{this.editIndex=Number(button.dataset.openBlock);this.newBlock=false;this.screen='block';this.render();});
      if(q('#sets-open'))q('#sets-open').onclick=()=>{if(this.dirty){this.message='Enregistrez ou annulez d’abord les horaires.';this.render();return;}this.screen='sets';this.render();};
      this.shadowRoot.querySelectorAll('[data-open-set]').forEach(button=>button.onclick=()=>{if(this.dirty){this.message='Enregistrez ou annulez d’abord les horaires.';this.render();return;}this.selectSet(button.dataset.openSet);});
      if(q('#new-set'))q('#new-set').onclick=()=>{if(this.dirty){this.message='Enregistrez ou annulez d’abord les horaires.';this.render();return;}this.selectSet('');};
      if(q('#add'))q('#add').onclick=()=>this.add();
      if(q('#save'))q('#save').onclick=()=>this.save();
      if(q('#reload'))q('#reload').onclick=()=>this.load();
      if(q('#copy'))q('#copy').onclick=()=>{let count=0;this.shadowRoot.querySelectorAll('.copies input:checked').forEach(input=>{this.draft[input.value]=clone(this.draft[this.day]);count++;});if(count){this.dirty=true;this.message=`${count} jour(s) remplacé(s). Enregistrez le planning.`;this.render();}};
      if(q('#copy-weekdays'))q('#copy-weekdays').onclick=()=>{for(const day of DAYS.slice(0,5))this.draft[day]=clone(this.draft[this.day]);this.dirty=true;this.message='Journée copiée du lundi au vendredi. Enregistrez le planning pour appliquer.';this.render();};
      if(q('#from'))q('#from').onchange=e=>{blocks[this.editIndex].from=e.value;this.dirty=true;};
      if(q('#to'))q('#to').onchange=e=>{blocks[this.editIndex].to=e.value;this.dirty=true;};
      this.shadowRoot.querySelectorAll('[data-profile]').forEach(button=>button.onclick=()=>{blocks[this.editIndex].data={...blocks[this.editIndex].data,profil:button.dataset.profile};this.dirty=true;this.render();});
      if(q('#block-done'))q('#block-done').onclick=()=>{try{const block=blocks[this.editIndex],from=minutes(block.from),to=minutes(block.to,true);if(to<=from)throw new Error('La fin doit être après le début.');block.from=formatTime(from);block.to=formatTime(to);this.screen='overview';this.message='Plage prête. Enregistrez le planning pour l’appliquer.';this.render();}catch(error){this.message=error.message;this.render();}};
      if(q('#block-delete'))q('#block-delete').onclick=()=>{blocks.splice(this.editIndex,1);this.dirty=true;this.screen='overview';this.render();};
      if(q('#set-name'))q('#set-name').oninput=e=>{this.setDraft.name=e.target.value;this.setDirty=true;};
      this.shadowRoot.querySelectorAll('[data-set-room]').forEach(input=>input.onchange=()=>{this.setDraft.temperatures[input.dataset.setRoom]=Number(input.value);this.setDirty=true;});
      if(q('#set-save'))q('#set-save').onclick=()=>this.saveSet();
      if(q('#set-cancel'))q('#set-cancel').onclick=()=>{this.setDirty=false;this.screen='sets';this.render();};
    }
  }
  if(!customElements.get('chauffage-planning-card'))customElements.define('chauffage-planning-card',ChauffagePlanningCard);
})();
