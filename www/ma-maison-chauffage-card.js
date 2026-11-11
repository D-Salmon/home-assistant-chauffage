/* Dynamic Ma maison card. One persisted room registry for UI and heating. */
(() => {
  const DOMAIN='ma_maison_chauffage';
  const PROFILES={confort:'Confort',eco:'Éco',nuit:'Nuit',absent:'Absent'};
  const MODES={planning:'Planning',manuel:'Manuel',...PROFILES};
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const temp=x=>typeof x==='number'&&Number.isFinite(x)?x.toLocaleString('fr-FR',{maximumFractionDigits:1})+' °C':'—';
  const dialPoint=value=>{const angle=(135+270*(value-5)/20)*Math.PI/180;return [120+90*Math.cos(angle),105+90*Math.sin(angle)];};
  const dialStep=value=>Math.min(25,Math.max(5,Math.round(value*2)/2));
  const dialFromPoint=(x,y)=>{let angle=Math.atan2(y-105,x-120)*180/Math.PI;if(angle>=45&&angle<135)angle=x<120?135:405;else if(angle<135)angle+=360;return dialStep(5+(angle-135)*20/270);};
  class MaMaisonCard extends HTMLElement {
    static getStubConfig(){return {type:'custom:ma-maison-chauffage-card'};}
    constructor(){super();this.attachShadow({mode:'open'});this.view='home';this.selected=null;this.dirty=false;this.dialTouched=false;this.busy=false;this.message='';this.pendingSettings=null;}
    setConfig(config){this.config=config;this.render();}
    set hass(hass){
      const previousRevision=this.model?.revision;
      this._hass=hass;this.readState(Object.values(hass.states));
      const planner=this.shadowRoot.querySelector('chauffage-planning-card');
      if(this.view==='planning'&&planner){planner.hass=hass;return;}
      if(this.view==='room'){
        if(!this.busy&&!this.dirty&&this.model?.revision!==previousRevision){this.render();return;}
        const room=this.model?.rooms.find(r=>r.id===this.selected);
        if(!this.busy&&!this.dirty&&room?.override?.until<=Date.now()/1000&&this.shadowRoot.querySelector('.override-until')){this.render();return;}
        const live=(this.status.rooms||[]).find(r=>r.id===this.selected)||{};
        const q=s=>this.shadowRoot.querySelector(s);
        if(room&&q('.room-detail-temperature strong')){
          const heating=this.relayState()==='on'&&live.hvac_action==='heating';
          q('.room-detail-temperature strong').textContent=temp(live.current_temperature);
          const activeOverride=this.model.settings.enabled&&!this.model.settings.absent&&room.override?.until>Date.now()/1000?room.override:null;
          q('.room-detail-target strong').textContent=temp(activeOverride?.temperature??live.target??live.temperature);
          if(!this.busy&&!this.dirty&&!this.dialTouched)this.updateDial(activeOverride?.temperature??live.target??live.temperature??room.temperatures[room.mode]??room.temperatures.confort);
          if(q('.valve-feedback'))q('.valve-feedback').textContent=this.valveFeedback(room,activeOverride?.temperature??live.target);
          q('.room-detail .hero-status strong').textContent=live.paused?'Chauffage en pause':live.fault||(!this.model.settings.enabled?'Chauffage arrêté':heating?'Chauffage en cours':'Chauffage en attente');
          q('.room-detail .hero-status small').textContent=MODES[live.profile]||live.profile||MODES[room.mode]||room.mode;
          if(q('.planning-preview'))q('.planning-preview').textContent=`Mode actuel : ${MODES[live.profile]||live.profile||MODES[room.mode]||room.mode} · Planning actuel : ${MODES[live.planning_profile]||live.planning_profile||'En attente'} à ${temp(live.planning_target)}`;
          q('.room-detail .hero').classList.toggle('heating',heating);
        }
        return;
      }
      if(!this.busy&&!this.dirty&&!['edit','room','settings'].includes(this.view))this.render();
    }
    updateDial(value,writeInput=true){
      if(typeof value!=='number'||!Number.isFinite(value))return;
      const q=s=>this.shadowRoot.querySelector(s),dial=q('#temperature-dial'),input=q('#override-temp');
      if(!dial||!input)return;
      const selected=dialStep(value),[x,y]=dialPoint(selected);
      if(writeInput)input.value=String(selected);
      dial.setAttribute('aria-valuenow',String(selected));dial.setAttribute('aria-valuetext',temp(selected));
      q('.dial-fill').style.strokeDasharray=`${(selected-5)*5} 100`;
      q('.dial-thumb').setAttribute('cx',String(x));q('.dial-thumb').setAttribute('cy',String(y));
      q('.dial-readout').textContent=temp(selected);
      const disabled=dial.getAttribute('aria-disabled')==='true';
      q('#override-minus').disabled=disabled||selected<=5;q('#override-plus').disabled=disabled||selected>=25;
    }
    readState(states){
      const entry=this.config?.entity?states.find(s=>s.entity_id===this.config.entity):states.find(s=>s.attributes?.integration===DOMAIN);
      const incoming=entry?.attributes?.configuration;
      if(this.pendingSettings&&incoming&&incoming.revision>=this.pendingSettings.revision)this.pendingSettings=null;
      this.model=this.pendingSettings&&incoming
        ?{...incoming,revision:this.pendingSettings.revision,settings:{...incoming.settings,...this.pendingSettings.payload}}
        :incoming;
      const status=entry?.attributes?.status||{};
      this.status=Number.isInteger(status.revision)&&incoming&&status.revision!==incoming.revision?{...status,rooms:[]}:status;
      this.homeName=this.model?.settings?.house_name||entry?.attributes?.house_name||'Ma maison';
    }
    relayState(){return this._hass?.states?.[this.model?.settings?.relay]?.state??this.status?.relay;}
    valveFeedback(room,requested){
      const raw=this._hass?.states?.[room.entity]?.attributes?.temperature;
      const reported=raw===null||raw===undefined||raw===''?null:Number(raw);
      const value=reported!==null&&Number.isFinite(reported)?reported:null;
      if(typeof requested!=='number'||!Number.isFinite(requested))return value===null?`Aucune consigne demandée actuellement. Aucune consigne lisible sur ${room.entity}.`:`Aucune consigne demandée actuellement. Consigne lue sur ${room.entity} : ${temp(value)}.`;
      if(value===null)return `Consigne demandée : ${temp(requested)}. Aucune consigne lisible sur ${room.entity}.`;
      return `Consigne demandée : ${temp(requested)}. Consigne lue sur ${room.entity} : ${temp(value)}. ${Math.abs(value-requested)<0.05?'Les valeurs correspondent dans Home Assistant.':'La valeur de l’entité n’a pas encore suivi.'}`;
    }
    getCardSize(){return Math.max(5,(this.model?.rooms.length||0)+3);}
    async refresh(){this.readState(await this._hass.callWS({type:'get_states'}));}
    note(message){this.message=message;const node=this.shadowRoot.querySelector('#message');if(node)node.textContent=message;}
    async command(operation,payload,revision=this.model?.revision,nextView=null){
      if(this.busy)return;
      this.busy=true;this.shadowRoot.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{
        await this._hass.callService(DOMAIN,'command',{operation,payload,revision});
        if(operation==='settings')this.pendingSettings={revision:revision+1,payload};
        this.dirty=false;await this.refresh();if(nextView){this.view=nextView;if(nextView==='home')this.selected=null;}if(operation==='remove_room')this.pendingRemove=null;
        this.message='Modification enregistrée.';this.busy=false;this.render();
      }catch(e){this.busy=false;this.shadowRoot.querySelectorAll('button').forEach(b=>b.disabled=false);this.note(e.message||String(e));}
    }
    navigate(view,id=null){
      if(this.dirty||this.shadowRoot.querySelector('chauffage-planning-card')?.dirty||this.shadowRoot.querySelector('chauffage-planning-card')?.setDirty){this.note('Enregistrez ou annulez les modifications avant de quitter cet écran.');return;}
      this.view=view;this.selected=id;this.dialTouched=false;this.pendingRemove=null;this.message='';this.render();
    }
    options(domain,selected='',exclude=[]){
      const ids=Object.keys(this._hass.states).filter(id=>id.startsWith(domain+'.')&&!exclude.includes(id));
      if(selected&&!ids.includes(selected))ids.unshift(selected);
      return '<option value="">Choisir…</option>'+ids.sort().map(id=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(this._hass.states[id]?.attributes?.friendly_name||id)} · ${esc(id)}</option>`).join('');
    }
    profileInputs(room){return Object.entries(PROFILES).map(([key,name])=>`<div><label for="${key}">${name} (°C)</label><input type="number" id="${key}" name="${key}" min="5" max="25" step="0.5" required value="${room.temperatures[key]}"></div>`).join('');}
    roomForm(room,editing){
      this.formRevision=this.model.revision;
      if(!editing){
        const live=(this.status.rooms||[]).find(r=>r.id===room.id)||{};
        const heating=this.relayState()==='on'&&live.hvac_action==='heating';
        const canOverride=this.model.settings.enabled&&!this.model.settings.absent;
        const activeOverride=room.override?.until>Date.now()/1000?room.override:null;
        const overrideValue=Number(activeOverride?.temperature??live.target??live.temperature??room.temperatures[room.mode]??room.temperatures.confort);
        const [thumbX,thumbY]=dialPoint(overrideValue);
        const state=live.paused?'Chauffage en pause':live.fault||(!this.model.settings.enabled?'Chauffage arrêté':heating?'Chauffage en cours':'Chauffage en attente');
        const profile=MODES[live.profile]||live.profile||MODES[room.mode]||room.mode;
        const planningProfile=MODES[live.planning_profile]||live.planning_profile||'En attente';
        return `<section class="room-detail">
          <header class="hero ${heating?'heating':''}">
            <button type="button" id="room-back" class="room-back" aria-label="Retour à l’accueil">← Accueil</button>
            <div class="hero-title"><span class="hero-house" aria-hidden="true"><ha-icon icon="mdi:radiator"></ha-icon></span><h2>${esc(room.name)}</h2></div>
            <div class="room-detail-summary"><div class="room-detail-temperature"><span>Température actuelle</span><strong>${temp(live.current_temperature)}</strong></div><div class="room-detail-target"><span>Consigne</span><strong>${temp(activeOverride?.temperature??live.target??live.temperature)}</strong></div></div>
            <div class="hero-status"><span class="status-icon" aria-hidden="true">♨</span><div><strong>${esc(state)}</strong><small>${esc(profile)}</small></div></div>
          </header>
          <div class="room-detail-body">
            <form id="override-form" class="room-detail-override"><h3>Consigne temporaire</h3><p class="valve-feedback" role="status">${esc(this.valveFeedback(room,activeOverride?.temperature??live.target))}</p>${activeOverride?`<p class="override-until">Consigne active jusqu’au ${esc(new Date(activeOverride.until*1000).toLocaleString('fr-FR'))}.</p>`:''}<p>Déplacez le repère sur l’arc pour choisir la température, puis indiquez la durée.</p>
              <div class="dial-wrap"><svg id="temperature-dial" class="temperature-dial" viewBox="0 0 240 205" role="slider" tabindex="${canOverride?'0':'-1'}" aria-label="Consigne temporaire" aria-valuemin="5" aria-valuemax="25" aria-valuenow="${overrideValue}" aria-valuetext="${temp(overrideValue)}" aria-disabled="${!canOverride}">
                <path class="dial-track" d="M 56.36 168.64 A 90 90 0 1 1 183.64 168.64" pathLength="100"></path>
                <path class="dial-fill" d="M 56.36 168.64 A 90 90 0 1 1 183.64 168.64" pathLength="100" style="stroke-dasharray:${(overrideValue-5)*5} 100"></path>
                <circle class="dial-thumb" cx="${thumbX}" cy="${thumbY}" r="10"></circle>
              </svg><div class="dial-center"><div class="dial-adjust"><button type="button" id="override-minus" aria-label="Diminuer la consigne temporaire de 0,5 °C" ${!canOverride||overrideValue<=5?'disabled':''}>−</button><strong class="dial-readout" aria-live="polite">${temp(overrideValue)}</strong><button type="button" id="override-plus" aria-label="Augmenter la consigne temporaire de 0,5 °C" ${!canOverride||overrideValue>=25?'disabled':''}>+</button></div><span class="dial-caption">Consigne souhaitée</span></div><div class="dial-limits"><span>5 °C</span><span>25 °C</span></div></div>
              <div class="profiles override-fields"><div><label for="override-temp">Température précise (°C)</label><input id="override-temp" name="temperature" type="number" min="5" max="25" step="0.5" value="${overrideValue}" ${canOverride?'':'disabled'} required></div><div><label for="hours">Durée (h)</label><input id="hours" name="hours" type="number" min="0.5" max="12" step="0.5" value="3" ${canOverride?'':'disabled'} required></div></div>
              <div class="actions"><button class="primary" type="submit" ${canOverride?'':'disabled'}>Appliquer</button><button type="button" id="resume">Retour au planning</button><span class="planning-preview">Mode actuel : ${esc(profile)} · Planning actuel : ${esc(planningProfile)} à ${temp(live.planning_target)}</span></div>${canOverride?'':'<p class="override-unavailable">Pour appliquer une consigne temporaire, activez le chauffage et quittez l’absence maison.</p>'}</form>
          </div></section>`;
      }
      return `<form id="room-form"><h2>${editing?(room.id?'Modifier la pièce':'Ajouter une pièce'):esc(room.name)}</h2>
        ${editing?`<label for="room-name">Nom de la pièce</label><input id="room-name" name="name" required maxlength="80" value="${esc(room.name)}"><label for="room-entity">Vanne thermostatique</label><select id="room-entity" name="entity" required>${this.options('climate',room.entity,this.model.rooms.filter(r=>r.id!==room.id).map(r=>r.entity))}</select><label for="pause-entity">Déclencheur de pause (facultatif)</label><select id="pause-entity" name="pause_entity"><option value="">Aucun</option>${Object.keys(this._hass.states).filter(id=>/^(binary_sensor|input_boolean|switch)\./.test(id)).sort().map(id=>`<option value="${esc(id)}">${esc(this._hass.states[id]?.attributes?.friendly_name||id)} · ${esc(id)}</option>`).join('')}</select><details class="help"><summary aria-label="Afficher l’explication">?</summary><p class="hint">Choisissez ici le détecteur d’ouverture de la fenêtre. Quand son état passe à on (fenêtre ouverte), la pièce est en pause ; quand il revient à off (fenêtre fermée), le chauffage reprend.</p></details>` : ''}
        <div class="profiles">${this.profileInputs(room)}</div>
        ${editing?`<label for="last-seen">Capteur de dernière communication de la vanne (facultatif)</label><select id="last-seen" name="last_seen">${this.options('sensor',room.last_seen||'')}</select><details class="help"><summary aria-label="Afficher l’explication">?</summary><p class="hint">À renseigner seulement si une entité capteur fournit la date et l’heure du dernier message de la vanne. Sans ce capteur, laissez le champ vide ; ce réglage est indépendant du déclencheur de pause d’une pièce.</p></details>`:''}
        <div class="actions"><button class="primary" type="submit">Enregistrer</button><button type="button" id="cancel">Annuler</button></div></form>`;
    }
    render(){
      if(!this.config)return;
      if(!this.model){this.shadowRoot.innerHTML='<ha-card style="padding:24px">Ajoutez l’intégration « Ma maison - Chauffage » dans Paramètres → Appareils et services, puis rechargez cette carte.</ha-card>';return;}
      const m=this.model,s=m.settings,rooms=m.rooms,details=new Map((this.status.rooms||[]).map(r=>[r.id,r]));
      const relayState=this.relayState();
      let content='';
      if(this.view==='home'){
        const heatingCount=Number(this.status.heating_count)||0;
        const outdoorState=s.outdoor_sensor?this._hass.states[s.outdoor_sensor]:null;
        const outdoorValue=outdoorState&&outdoorState.state!==''?Number(outdoorState.state):NaN;
        const outdoorTemp=Number.isFinite(outdoorValue)?outdoorValue:null;
        const activePlan=s.active_schedule?this._hass.states[s.active_schedule]:null;
        const planStatus=!s.active_schedule?'Aucun planning choisi':!activePlan||!['on','off'].includes(activePlan.state)?'Planning indisponible':activePlan.state==='off'?'Hors plage : Éco':activePlan.attributes?.profil&&PROFILES[activePlan.attributes.profil]?`Plage actuelle : ${PROFILES[activePlan.attributes.profil]}`:s.temperature_sets?.[activePlan.attributes?.profil]?`Plage actuelle : ${s.temperature_sets[activePlan.attributes.profil].name}`:'Plage active sans profil défini';
        const headline=relayState==='on'&&heatingCount>0?`Chauffage demandé par ${heatingCount} ${heatingCount===1?'vanne':'vannes'}`:!s.enabled?'Chauffage arrêté':s.absent?'Maison absente':esc(s.schedules.find(p=>p.entity===s.active_schedule)?.name||'Choisir un planning');
        content=`<section class="home-shell">
          <header class="hero ${relayState==='on'?'heating':''}">
            <div class="hero-title"><span class="hero-house" aria-hidden="true">⌂</span><h2>${esc(this.homeName)}</h2></div>
            <div class="hero-summary ${outdoorTemp!==null?'has-outdoor':''}"><div class="hero-status"><span class="status-icon" aria-hidden="true">♨</span><div><strong>${headline}</strong><small>${relayState==='on'?'Chaudière en marche':relayState==='off'?'Chaudière arrêtée':'Relais indisponible'} · ${rooms.length} pièce(s)</small></div></div>${outdoorTemp!==null?`<div class="outdoor-tile" aria-label="Température extérieure ${temp(outdoorTemp)}"><ha-icon icon="mdi:thermometer" aria-hidden="true"></ha-icon><span>Extérieur</span><strong>${temp(outdoorTemp)}</strong></div>`:''}</div>
            <div class="picker"><div><label for="active-plan">Mon planning</label><select id="active-plan"><option value="">Sans planning</option>${s.schedules.map(p=>`<option value="${esc(p.entity)}" ${p.entity===s.active_schedule?'selected':''}>${esc(p.name)}</option>`).join('')}</select><small class="plan-status">${esc(planStatus)}</small></div><button id="absent" type="button" aria-pressed="${s.absent}">Absent${s.absent?' ✓':''}</button></div>
          </header>
          <section class="rooms-panel"><h3>Pièces</h3>${rooms.map(r=>{const live=details.get(r.id)||{};const isHeating=relayState==='on'&&live.hvac_action==='heating';const activeOverride=s.enabled&&!s.absent&&r.override?.until>Date.now()/1000?r.override:null;const shownSetpoint=activeOverride?.temperature??live.target??live.temperature;return `<button class="room" data-room="${r.id}"><span class="room-icon ${isHeating?'heating':''}" role="img" aria-label="${isHeating?'Chauffage en cours':'Chauffage à l’arrêt'}"><ha-icon icon="mdi:radiator"></ha-icon></span><span class="room-copy"><strong>${esc(r.name)}</strong><span class="room-temp">${temp(live.current_temperature)}</span><small>${esc(activeOverride?'Consigne temporaire':live.paused?'Pause (capteur actif)':live.fault||MODES[live.profile]||live.profile||'En attente')}</small></span><span class="setpoint" aria-label="Consigne ${temp(shownSetpoint)}">${temp(shownSetpoint)}</span></button>`;}).join('')||'<p>Ajoutez votre première vanne dans Gérer les pièces.</p>'}<details class="help"><summary aria-label="Afficher l’explication">?</summary><p class="hint">Salle de bain : le radiateur toujours ouvert chauffe avec le circuit.</p></details></section>
        </section>`;
      }else if(this.view==='manage'){
        content=`<h2>Gérer les pièces</h2><details class="help"><summary aria-label="Afficher l’explication">?</summary><p class="hint">${rooms.length} vanne(s). Cette liste pilote aussi les consignes et la chaudière.</p></details><button class="primary" id="add">+ Ajouter une vanne</button>${rooms.map(r=>`<div class="manage-row"><div><strong>${esc(r.name)}</strong><small>${esc(r.entity)}</small></div><div class="actions"><button data-edit="${r.id}">Modifier</button><button data-remove="${r.id}">Retirer</button></div></div>`).join('')}`;
        if(this.pendingRemove)content+=`<div class="warning"><p>Retirer ${esc(rooms.find(r=>r.id===this.pendingRemove)?.name)} de la gestion ? La vanne garde sa dernière consigne et peut encore chauffer avec le circuit. Mettez-la sur OFF dans HA si vous souhaitez l’arrêter.</p><button id="confirm-remove">Retirer de la gestion</button><button id="cancel-remove">Conserver</button></div>`;
      }else if(this.view==='edit'||this.view==='room'){
        const room=rooms.find(r=>r.id===this.selected)||(!this.selected?{name:'',entity:'',mode:'planning',last_seen:'',temperatures:{confort:20,eco:17,nuit:17,absent:14}}:null);
        content=room?this.roomForm(room,this.view==='edit'):'Cette pièce a été retirée. Revenez à l’accueil.';
      }else if(this.view==='settings'){
        this.formRevision=m.revision;
        content=`<form id="settings-form"><h2>Réglages</h2><label for="house-name">Nom de la maison</label><input id="house-name" name="house_name" maxlength="80" required value="${esc(this.homeName)}"><label class="check"><input name="enabled" type="checkbox" ${s.enabled?'checked':''}>Chauffage autorisé</label><label for="relay">Relais chaudière</label><select id="relay" name="relay">${this.options('switch',s.relay)}</select><details class="help"><summary aria-label="Afficher l’explication">?</summary><p class="hint">Pour changer de relais, arrêtez d’abord le chauffage et vérifiez que l’ancien relais est OFF.</p></details><label for="schedules">Plannings disponibles (sélection multiple)</label><select id="schedules" name="schedules" multiple size="5">${Object.keys(this._hass.states).filter(id=>id.startsWith('schedule.')).sort().map(id=>`<option value="${esc(id)}" ${s.schedules.some(p=>p.entity===id)?'selected':''}>${esc(this._hass.states[id].attributes.friendly_name||id)}</option>`).join('')}</select><details class="help"><summary aria-label="Afficher l’explication">?</summary><p class="hint">Créez les assistants Planning dans HA, puis sélectionnez-les ici. Les horaires se modifient dans Plannings.</p></details><label class="check"><input name="anticipation_enabled" type="checkbox" ${s.anticipation_enabled?'checked':''}>Anticipation adaptative de chauffe et d’arrêt</label><details class="help"><summary aria-label="Afficher l’explication">?</summary><p class="hint">En mode Planning, la vanne reçoit sa nouvelle consigne en avance pour que la pièce atteigne la température demandée à l’heure prévue. L’arrêt est également anticipé avant une baisse de température.</p></details><label for="anticipation-window">Période d’apprentissage glissante</label><select id="anticipation-window" name="anticipation_window_days"><option value="7">7 jours</option><option value="14">14 jours</option></select><details class="help"><summary aria-label="Afficher l’explication">?</summary><p class="hint">L’apprentissage utilise les mesures récentes de chaque pièce. Il s’actualise quand le chauffage est autorisé et garde ses données quand il est arrêté. Les mesures plus anciennes que cette période sont écartées.</p></details><label for="outdoor-sensor">Capteur extérieur (facultatif, °C)</label><select id="outdoor-sensor" name="outdoor_sensor"><option value="">Aucun</option>${Object.keys(this._hass.states).filter(id=>id.startsWith('sensor.')&&this._hass.states[id].attributes?.unit_of_measurement==='°C').sort().map(id=>`<option value="${esc(id)}">${esc(this._hass.states[id].attributes.friendly_name||id)}</option>`).join('')}</select><details class="help"><summary aria-label="Afficher l’explication">?</summary><p class="hint">Sa température s’affiche aussi sur l’accueil. Si tu en choisis un, l’apprentissage privilégie les mesures relevées par une météo extérieure proche (à ±5 °C). Sinon, ou s’il y a trop peu de mesures comparables, toutes les mesures disponibles sont utilisées. L’estimation s’affine au fil de l’utilisation.</p></details><div class="profiles">${[["confirm_seconds","Confirmation avant démarrage (s)",0,600,"Le relais ne démarre que si une demande de chauffage reste présente pendant toute cette durée."],["stop_seconds","Attente avant arrêt (s)",0,300,"Quand toutes les vannes cessent de demander, le relais reste allumé pendant ce délai puis s’arrête."],["minimum_off","Délai minimal avant relance du chauffage (s)",0,1800,"Après l’arrêt du relais, le chauffage attend au moins ce délai avant de pouvoir redémarrer."],["freshness_minutes","Délai maximal depuis la dernière communication avec la vanne (min)",5,1500,"Ce contrôle s’applique uniquement si la pièce possède un capteur de date et heure de dernière communication. Sans ce capteur, ce réglage est ignoré."]].map(([k,n,min,max,hint])=>`<div><label for="${k}">${n}</label><input name="${k}" id="${k}" type="number" min="${min}" max="${max}" value="${s[k]}" required><details class="help"><summary aria-label="Afficher l’explication">?</summary><p class="hint">${hint}</p></details></div>`).join('')}</div><div class="actions"><button type="submit" class="primary">Enregistrer</button><button type="button" id="cancel">Annuler</button></div></form><button id="retry">Réessayer les commandes du relais</button>`;
      }else if(this.view==='planning'){
        content=s.schedules.length?'<div id="planner"></div>':'Choisissez vos assistants Planning dans Réglages.';
      }
      this.shadowRoot.innerHTML=`<style>
        :host{display:block;font-family:system-ui,sans-serif;color:var(--primary-text-color)}*{box-sizing:border-box}ha-card{padding:18px;border-radius:24px}h2{font-size:24px;margin:0 0 16px}h3{font-size:17px;margin:22px 0 12px}p{line-height:1.5}label{display:block;font-size:13px;margin:14px 0 5px}input,select,button{font:inherit;font-size:15px;min-height:44px;padding:10px;border:1px solid var(--divider-color);border-radius:12px;color:inherit;background:var(--ha-card-background,var(--card-background-color));max-width:100%}input,select{width:100%;min-width:0}button{cursor:pointer;transition:filter .15s ease,box-shadow .15s ease}button:not(:disabled):hover{filter:brightness(1.1);box-shadow:0 2px 10px #0002}button:focus-visible{outline:3px solid var(--primary-color);outline-offset:2px}button:disabled{opacity:.5}.primary{background:#406bfa;color:white;border-color:#406bfa}.hero{background:linear-gradient(135deg,#192778,#4074ff);color:white;padding:24px;border-radius:20px;margin-bottom:16px}.hero.heating{background:linear-gradient(135deg,#8f1721,#e53935)}.hero p{margin-bottom:7px;color:#fff;font-weight:600}.hero small{display:block;color:#fff;font-size:13px;font-weight:600;opacity:1}.picker{display:grid;grid-template-columns:minmax(0,1fr) 95px;gap:10px;align-items:end}.picker label{margin-top:0}[aria-pressed=true]{background:#e8edff;color:#2747aa}.room{display:grid;grid-template-columns:44px minmax(0,1fr) 76px;width:100%;gap:12px;text-align:left;align-items:center;border:0;border-bottom:1px solid var(--divider-color);border-radius:0;padding:16px 0}.room strong,.room span span,small{display:block}.room small{margin-top:5px;color:var(--secondary-text-color);overflow-wrap:anywhere}.room-icon{font-size:26px;color:#e77829}.room-icon.heating{animation:heat-pulse 1.1s ease-in-out infinite;color:#ef5f16}@keyframes heat-pulse{0%,100%{transform:scale(1);filter:drop-shadow(0 0 0 #ef5f1630);opacity:.78}50%{transform:scale(1.2);filter:drop-shadow(0 0 7px #ef5f16aa);opacity:1}}@media(prefers-reduced-motion:reduce){.room-icon.heating{animation:none;filter:drop-shadow(0 0 5px #ef5f1680);opacity:1}}.setpoint{padding:13px 5px;text-align:center;background:#406bfa;color:white;border-radius:14px}.profiles{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}.hint,small{font-size:12px;color:var(--secondary-text-color)}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.nav{display:flex;flex-wrap:wrap;gap:5px;margin-top:22px;border-top:1px solid var(--divider-color);padding-top:12px}.nav button{flex:1 1 0;font-size:14px;font-weight:600;min-width:0;min-height:48px;padding:10px 3px;line-height:1.2}.manage-row{padding:16px 0;border-bottom:1px solid var(--divider-color)}.manage-row small{overflow-wrap:anywhere;margin-top:5px}.check{display:flex;align-items:center;gap:9px}.check input{width:22px}.warning{padding:12px;background:var(--secondary-background-color);border-radius:12px}.warning button{margin:4px}#message{font-size:13px;white-space:pre-line;overflow-wrap:anywhere;margin-top:16px}.help{display:inline-block;vertical-align:middle;margin:0 0 0 6px}.help summary{list-style:none;cursor:pointer;display:grid;place-items:center;width:22px;height:22px;border:1px solid var(--secondary-text-color);border-radius:50%;font-size:13px;font-weight:700;color:var(--secondary-text-color)}.help summary::-webkit-details-marker{display:none}.help summary:focus-visible{outline:3px solid var(--primary-color);outline-offset:2px}.help[open]{display:block;margin:5px 0 8px}.help .hint{margin:6px 0;padding:8px 10px;background:var(--secondary-background-color);border-radius:8px}details{margin-top:18px}hr{border:0;border-top:1px solid var(--divider-color);margin:22px 0}
.home-card{padding:0;overflow:hidden}.home-card #message{margin:0 20px}.home-shell{background:var(--ha-card-background,var(--card-background-color))}.home-shell .hero{border-radius:0 0 28px 28px;padding:26px 24px 22px;margin:0;background:linear-gradient(160deg,#1b318d,#3d79f5);transition:background .25s ease}.home-shell .hero.heating{background:linear-gradient(160deg,#8b1727,#e34842)}.hero-title{display:flex;align-items:center;gap:12px;margin-bottom:34px}.hero-title h2{margin:0;font-size:clamp(27px,6vw,38px);line-height:1.12;overflow-wrap:anywhere}.hero-house{font-size:28px;line-height:1}.hero-status{display:flex;align-items:center;gap:14px;padding:16px;border-radius:22px;background:#12235b88;color:white}.hero-status strong{display:block;font-size:18px;line-height:1.25}.hero-status small{margin-top:6px}.status-icon{display:grid;place-items:center;flex:none;width:48px;height:48px;border-radius:15px;background:#ffffff30;font-size:27px}.home-shell .picker{margin-top:14px}.home-shell .picker label{color:#fff;font-weight:600}.home-shell .picker select{background:#ffffff28;border-color:#ffffff55;color:white}.home-shell .picker select option{color:#111}.home-shell #absent{background:#ffffff28;border-color:#ffffff55;color:white;font-weight:600}.home-shell #absent[aria-pressed=true]{background:white;color:#2747aa}.rooms-panel{padding:25px 24px 10px}.rooms-panel h3{font-size:24px;margin:0 0 12px}.rooms-panel .room{grid-template-columns:62px minmax(0,1fr) auto;gap:16px;min-height:104px;padding:15px 0}.rooms-panel .room-icon{display:grid;place-items:center;width:62px;height:62px;border-radius:20px;background:var(--secondary-background-color,#f2f3f6);color:var(--primary-text-color);font-size:28px}.rooms-panel .room-icon.heating{color:#e5483b}.rooms-panel .room-copy{min-width:0}.rooms-panel .room-copy strong{font-size:18px;line-height:1.2;overflow-wrap:anywhere}.rooms-panel .room-temp{font-size:18px;margin-top:4px}.rooms-panel .setpoint{min-width:70px;background:#e7efff;color:#315bd1;font-weight:700;white-space:nowrap}.home-card .nav{margin:0;padding:12px 18px 16px}.home-card .nav button{border:0;background:transparent;color:var(--secondary-text-color);font-weight:600}.home-card .nav button[aria-pressed=true]{color:#3475eb;background:#e8f0ff}@media(max-width:420px){.rooms-panel{padding-left:18px;padding-right:18px}.rooms-panel .room{grid-template-columns:54px minmax(0,1fr) auto;gap:11px}.rooms-panel .room-icon{width:54px;height:54px}.rooms-panel .room-copy strong{font-size:16px}.rooms-panel .setpoint{min-width:62px;padding:11px 5px;font-size:13px}}
.hero-summary{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.hero-summary.has-outdoor{grid-template-columns:minmax(0,1fr) 110px}.hero-summary.has-outdoor .hero-status{gap:10px;padding:12px;min-width:0}.hero-summary.has-outdoor .status-icon{width:40px;height:40px;font-size:23px}.hero-summary.has-outdoor .hero-status strong{font-size:16px}.hero-summary.has-outdoor .hero-status small{font-size:11px}.outdoor-tile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:22px;background:#12235b88;color:#fff;text-align:center;padding:8px 4px}.outdoor-tile ha-icon{--mdc-icon-size:22px}.outdoor-tile span{font-size:11px}.outdoor-tile strong{font-size:17px;white-space:nowrap}@media(max-width:420px){.hero-summary.has-outdoor{grid-template-columns:minmax(0,1fr) 94px}.hero-summary.has-outdoor .hero-status strong{font-size:14px}.hero-summary.has-outdoor .status-icon{width:34px;height:34px;font-size:20px}.outdoor-tile strong{font-size:15px}}
.room-card{padding:0;overflow:hidden}.room-card #message{margin:0 20px}.room-detail .hero{border-radius:0 0 28px 28px;padding:22px 24px 24px;margin:0;background:linear-gradient(160deg,#1b318d,#3d79f5);color:white}.room-detail .hero.heating{background:linear-gradient(160deg,#8b1727,#e34842)}.room-back{border:0;background:#ffffff26;color:white;min-height:36px;padding:7px 12px;margin-bottom:20px;font-size:14px}.room-detail .hero-title{margin-bottom:22px}.room-detail .hero-house{display:grid;place-items:center}.room-detail-summary{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-bottom:14px}.room-detail-summary>div{padding:14px;border-radius:18px;background:#12235b88;min-width:0}.room-detail-summary span{display:block;font-size:13px;font-weight:600}.room-detail-summary strong{display:block;font-size:clamp(23px,6vw,32px);margin-top:4px;white-space:nowrap}.room-detail .hero-status{background:#12235b88}.room-detail-body{padding:24px}.room-detail-body h3{font-size:20px;margin:0 0 10px}.room-detail-body p{margin:0 0 14px}.room-detail-body .actions{margin-bottom:0}.room-detail-body .primary{font-weight:700}.room-detail-override{padding-bottom:24px;border-bottom:1px solid var(--divider-color)}.room-detail-profiles{padding-top:24px}.room-detail-body .override-until{margin:14px 0 0;font-weight:600}.room-card .nav{margin:0;padding:12px 18px 16px}.room-card .nav button{border:0;background:transparent;color:var(--secondary-text-color)}@media(max-width:420px){.room-detail .hero{padding-left:18px;padding-right:18px}.room-detail-body{padding:20px 18px}.room-detail-summary strong{font-size:23px}}
.dial-wrap{position:relative;width:min(100%,240px);margin:8px auto 16px}.temperature-dial{display:block;width:100%;height:auto;touch-action:none;cursor:pointer;overflow:visible}.temperature-dial[aria-disabled="true"]{opacity:.5;cursor:default}.temperature-dial:focus-visible{outline:3px solid var(--primary-color);outline-offset:2px;border-radius:18px}.dial-track,.dial-fill{fill:none;stroke-width:13;stroke-linecap:round}.dial-track{stroke:var(--divider-color,#e5e7eb)}.dial-fill{stroke:#91d49d}.dial-thumb{fill:#fff;stroke:#57b96a;stroke-width:4;filter:drop-shadow(0 2px 4px #0003)}.dial-center{position:absolute;top:51%;left:0;width:100%;transform:translateY(-50%);text-align:center;pointer-events:none}.dial-adjust{display:flex;align-items:center;justify-content:center;gap:4px}.dial-adjust button{display:grid;place-items:center;width:40px;height:40px;min-height:40px;padding:0;border-radius:50%;border-color:#91d49d;background:var(--ha-card-background,var(--card-background-color));color:var(--primary-text-color);font-size:26px;font-weight:600;pointer-events:auto}.dial-readout{min-width:74px;font-size:22px;font-weight:700;white-space:nowrap;color:var(--primary-text-color)}.dial-caption{display:block;margin-top:3px;font-size:12px;color:var(--secondary-text-color)}.dial-limits{display:flex;justify-content:space-between;padding:0 18px;margin-top:-12px;font-size:12px;color:var(--secondary-text-color)}.override-fields{margin-top:10px}
.resume-control{padding:14px;margin:12px 0 18px;border-radius:16px;background:var(--secondary-background-color,#f3f5f8)}.room-detail-body .resume-control .override-until{margin:0 0 8px}.resume-control label{margin:0 0 6px}.resume-picker{display:flex;gap:8px}.resume-picker select{flex:1;min-width:0}.resume-picker button{flex:0 0 auto;font-weight:700}@media(max-width:420px){.resume-picker{flex-direction:column}}
.planning-preview{display:block;flex:1 1 180px;min-width:0;align-self:center;font-size:12px;line-height:1.4;color:var(--secondary-text-color)}
.rooms-panel .room-icon.heating{animation:none;background:#fff0ef;color:#d6322e}.rooms-panel .room-icon.heating ha-icon{color:#d6322e;animation:heat-pulse 1.1s ease-in-out infinite;transform-origin:center;will-change:transform}@media(prefers-reduced-motion:reduce){.rooms-panel .room-icon.heating ha-icon{animation:none;filter:none;opacity:1}}
      </style><ha-card class="${this.view==='home'?'home-card':this.view==='room'?'room-card':''}">${content}<div id="message" role="status" aria-live="polite">${esc(this.message||(this.status.faults||[]).join('\n'))}</div><div class="nav">${[['home','Accueil'],['planning','Plannings'],['manage','Pièces'],['settings','Réglages']].map(([v,l])=>`<button data-nav="${v}" aria-pressed="${this.view===v}">${l}</button>`).join('')}</div></ha-card>`;
      const q=s=>this.shadowRoot.querySelector(s),all=s=>this.shadowRoot.querySelectorAll(s);
      all('[data-nav]').forEach(b=>b.onclick=()=>this.navigate(b.dataset.nav));
      all('[data-room]').forEach(b=>b.onclick=()=>this.navigate('room',b.dataset.room));
      if(q('#room-back'))q('#room-back').onclick=()=>this.navigate('home');
      all('[data-edit]').forEach(b=>b.onclick=()=>this.navigate('edit',b.dataset.edit));
      all('[data-remove]').forEach(b=>b.onclick=()=>{this.pendingRemove=b.dataset.remove;this.render();});
      if(q('#add'))q('#add').onclick=()=>this.navigate('edit');
      if(q('#confirm-remove'))q('#confirm-remove').onclick=()=>this.command('remove_room',{id:this.pendingRemove},m.revision,'home');
      if(q('#cancel-remove'))q('#cancel-remove').onclick=()=>{this.pendingRemove=null;this.render();};
      if(q('#active-plan'))q('#active-plan').onchange=e=>this.command('settings',{active_schedule:e.target.value});
      if(this.view==='home'&&q('#absent'))q('#absent').onclick=()=>this.command('settings',{absent:!s.absent});
      if(q('#cancel'))q('#cancel').onclick=()=>{this.dirty=false;this.navigate('home');};
      if(q('#resume'))q('#resume').onclick=()=>this.command('resume',{id:this.selected,mode:'planning'},this.formRevision,'home');
      if(q('#retry'))q('#retry').onclick=()=>this.command('retry',{});
      const roomForm=q('#room-form');if(roomForm){roomForm.oninput=()=>this.dirty=true;roomForm.onsubmit=e=>{e.preventDefault();const values=new FormData(roomForm),room=m.rooms.find(r=>r.id===this.selected),payload={name:room?.name,entity:room?.entity,mode:values.get('mode')||room?.mode||'planning',temperatures:Object.fromEntries(Object.keys(PROFILES).map(p=>[p,Number(values.get(p))]))};if(room)payload.id=room.id;if(this.view==='edit'){payload.name=values.get('name');payload.entity=values.get('entity');payload.last_seen=values.get('last_seen');payload.pause_entity=values.get('pause_entity')||'';}this.command('save_room',payload,this.formRevision,'home');};}
      const override=q('#override-form');if(override)override.onsubmit=e=>{e.preventDefault();if(this.dirty){this.note('Enregistrez d’abord les réglages de la pièce.');return;}const v=new FormData(override);this.command('override',{id:this.selected,temperature:Number(v.get('temperature')),hours:Number(v.get('hours'))},this.formRevision,'home');};
      const dial=q('#temperature-dial'),dialInput=q('#override-temp'),minus=q('#override-minus'),plus=q('#override-plus');
      if(dial&&dialInput&&dial.getAttribute('aria-disabled')==='false'){
        const updateDial=(value,writeInput=true)=>{this.dialTouched=true;this.updateDial(value,writeInput);};
        const moveDial=e=>{
          const rect=dial.getBoundingClientRect(),scale=Math.min(rect.width/240,rect.height/205);
          if(!scale)return;
          const x=(e.clientX-rect.left-(rect.width-240*scale)/2)/scale;
          const y=(e.clientY-rect.top-(rect.height-205*scale)/2)/scale;
          if(Math.hypot(x-120,y-105)<60||Math.hypot(x-120,y-105)>120)return false;
          updateDial(dialFromPoint(x,y));return true;
        };
        let dragging=false;
        dial.onpointerdown=e=>{if(!moveDial(e))return;dragging=true;dial.setPointerCapture?.(e.pointerId);};
        dial.onpointermove=e=>{if(dragging)moveDial(e);};
        dial.onpointerup=dial.onpointercancel=()=>{dragging=false;};
        dial.onkeydown=e=>{
          const current=Number(dialInput.value);
          const next=({ArrowUp:current+.5,ArrowRight:current+.5,ArrowDown:current-.5,ArrowLeft:current-.5,PageUp:current+1,PageDown:current-1,Home:5,End:25})[e.key];
          if(next===undefined)return;
          e.preventDefault();updateDial(next);
        };
        dialInput.oninput=()=>{this.dialTouched=true;const value=Number(dialInput.value);if(dialInput.value!==''&&value>=5&&value<=25)updateDial(value,false);};
        dialInput.onchange=()=>{const value=Number(dialInput.value);if(dialInput.value!==''&&Number.isFinite(value))updateDial(value);};
        minus.onclick=()=>updateDial(Number(dialInput.value)-.5);
        plus.onclick=()=>updateDial(Number(dialInput.value)+.5);
      }
      const settings=q('#settings-form');if(settings){settings.oninput=()=>this.dirty=true;settings.onsubmit=e=>{e.preventDefault();const v=new FormData(settings),schedules=v.getAll('schedules').map(id=>({entity:id,name:s.schedules.find(p=>p.entity===id)?.name||this._hass.states[id].attributes.friendly_name||id}));const payload={house_name:v.get('house_name'),enabled:v.has('enabled'),anticipation_enabled:v.has('anticipation_enabled'),anticipation_window_days:Number(v.get('anticipation_window_days')),outdoor_sensor:v.get('outdoor_sensor')||'',relay:v.get('relay'),schedules,active_schedule:schedules.some(p=>p.entity===s.active_schedule)?s.active_schedule:schedules[0]?.entity||''};for(const key of ['confirm_seconds','stop_seconds','minimum_off','freshness_minutes'])payload[key]=Number(v.get(key));this.command('settings',payload,this.formRevision,'home');};}
      // Set live form properties as well as initial HTML attributes.
      if(roomForm){const current=rooms.find(r=>r.id===this.selected);if(q('#mode'))q('#mode').value=current?.mode||'planning';if(q('#room-entity'))q('#room-entity').value=current?.entity||'';if(q('#last-seen'))q('#last-seen').value=current?.last_seen||'';if(q('#pause-entity'))q('#pause-entity').value=current?.pause_entity||'';}
      if(settings){q('#relay').value=s.relay;q('#anticipation-window').value=String(s.anticipation_window_days);q('#outdoor-sensor').value=s.outdoor_sensor||'';all('#schedules option').forEach(o=>o.selected=s.schedules.some(p=>p.entity===o.value));}
      if(q('#active-plan'))q('#active-plan').value=s.active_schedule;
      if(q('#planner')){if(customElements.get('chauffage-planning-card')){const card=document.createElement('chauffage-planning-card');card.addEventListener('chauffage-planning-saved',()=>{this.navigate('home');this.note('Planning enregistré.');});card.addEventListener('chauffage-temperature-set-saved',async()=>{await this.refresh();this.navigate('home');this.note('Jeu de températures enregistré.');});card.addEventListener('chauffage-temperature-set-removed',async()=>{await this.refresh();this.navigate('home');this.note('Jeu de températures supprimé.');});card.setConfig({schedules:s.schedules,active_schedule:s.active_schedule,rooms,temperature_sets:s.temperature_sets||{},revision:m.revision});card.hass=this._hass;q('#planner').append(card);}else q('#planner').textContent='Chargez aussi la ressource chauffage-planning-card.js.';}
    }
  }
  if(!customElements.get('ma-maison-chauffage-card'))customElements.define('ma-maison-chauffage-card',MaMaisonCard);
  window.customCards=window.customCards||[];
  window.customCards.push({type:'ma-maison-chauffage-card',name:'Ma maison - Chauffage',description:'Pièces et profils dynamiques, chaudière et plannings sans YAML au quotidien.',preview:false});
})();


