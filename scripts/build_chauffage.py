from pathlib import Path
import sys, json
import yaml
OUT=Path(__file__).parent.parent/'configuration'
ROOMS=[('salon','Salon','sofa-outline'),('cuisine','Cuisine','pot-steam-outline'),('chambre_1','Chambre 1','bed-outline'),('chambre_2','Chambre 2','bed-outline'),('chambre_3','Chambre 3','bed-outline'),('bureau','Bureau','desk'),('entree','Entrée','door'),('piece_8','Pièce 8','radiator')]
KEYS=[r[0] for r in ROOMS]
def ent(domain,key,suffix=''): return f'{domain}.chauffage_{key}'+('_'+suffix if suffix else '')
def call(service,entity,data=None):
    d={'service':service,'target':{'entity_id':entity}}
    if data is not None:d['data']=data
    return d
def cond(t):return {'condition':'template','value_template':t}
def write(name,obj):
    (OUT/name).write_text('# Configuration à adapter ; voir GUIDE-CHAUFFAGE.md.\n'+yaml.safe_dump(obj,allow_unicode=True,sort_keys=False,width=110),encoding='utf-8')
pkg={'input_boolean':{'chauffage_absent':{'name':'Absent','icon':'mdi:home-export-outline'},'chauffage_configuration_initialisee':{'name':'Chauffage - réglages initialisés'},'chauffage_profils_initialises':{'name':'Chauffage - quatre profils initialisés'}},
     'input_select':{'chauffage_planning':{'name':'Mon planning','icon':'mdi:calendar-clock','options':['Habituel','Télétravail','Vacances à la maison']}},
     'input_number':{'chauffage_duree_manuelle':{'name':'Durée de la prochaine dérogation','min':.5,'max':12,'step':.5,'unit_of_measurement':'h','mode':'box'}},
     'input_datetime':{},'script':{},'automation':[]}
ends=[]
for key,name,icon in ROOMS:
    pkg['input_select'][f'chauffage_{key}_mode']={'name':f'{name} - mode','options':['Planning','Confort','Éco','Nuit','Absent'],'icon':'mdi:thermostat'}
    for suffix,label in [('confort','Confort'),('eco','Éco'),('nuit','Nuit'),('absent','Absent'),('manuel','Nouvelle consigne'),('cible','Consigne temporaire active')]:
        pkg['input_number'][f'chauffage_{key}_{suffix}']={'name':f'{name} - {label}','min':5,'max':25,'step':.5,'unit_of_measurement':'°C','mode':'box'}
    pkg['input_datetime'][f'chauffage_{key}_fin']={'name':f'{name} - fin de dérogation','has_date':True,'has_time':True}
    ends.append(ent('input_datetime',key,'fin'))
zero=call('input_datetime.set_datetime',ends,{'datetime':'2000-01-01 00:00:00'})
# One-time explicit setup: no initial values which would reset preferences at each HA restart.
setup=[{'condition':'state','entity_id':'input_boolean.chauffage_autorise','state':'off'},
       {'condition':'state','entity_id':'input_boolean.chauffage_configuration_initialisee','state':'off'}]
for suffix,value in [('confort',20),('eco',17),('nuit',17),('absent',14),('manuel',20),('cible',20)]:
    setup.append(call('input_number.set_value',[ent('input_number',k,suffix) for k in KEYS],{'value':value}))
setup += [call('input_number.set_value','input_number.chauffage_duree_manuelle',{'value':3}),zero,call('input_boolean.turn_off','input_boolean.chauffage_absent'),call('input_select.select_option',[ent('input_select',k,'mode') for k in KEYS],{'option':'Planning'}),call('input_boolean.turn_on',['input_boolean.chauffage_configuration_initialisee','input_boolean.chauffage_profils_initialises'])]
pkg['script']['chauffage_initialiser']={'alias':'Chauffage - initialiser une seule fois','mode':'single','sequence':setup}
pkg['script']['chauffage_initialiser_nouveaux_profils']={'alias':'Chauffage - initialiser Nuit et Absent sans changer Confort et Éco','mode':'single','sequence':[
 {'condition':'state','entity_id':'input_boolean.chauffage_autorise','state':'off'},
 {'condition':'state','entity_id':'input_boolean.chauffage_configuration_initialisee','state':'on'},
 {'condition':'state','entity_id':'input_boolean.chauffage_profils_initialises','state':'off'},
 call('input_number.set_value',[ent('input_number',k,'nuit') for k in KEYS],{'value':17}),
 call('input_number.set_value',[ent('input_number',k,'absent') for k in KEYS],{'value':14}),
 call('input_boolean.turn_on','input_boolean.chauffage_profils_initialises')]}
pkg['script']['chauffage_basculer_absence']={'alias':'Chauffage - Absent / retour','mode':'single','sequence':[zero,call('input_boolean.toggle','input_boolean.chauffage_absent')]}
pkg['script']['chauffage_annuler_derogations']={'alias':'Chauffage - reprendre le planning partout','mode':'single','sequence':[zero]}
for k,name,_ in ROOMS:
    pkg['script'][f'chauffage_{k}_appliquer']={'alias':f'{name} - appliquer la consigne temporaire','mode':'restart','sequence':[
        {'condition':'state','entity_id':'input_boolean.chauffage_autorise','state':'on'},
        {'condition':'state','entity_id':'input_boolean.chauffage_configuration_initialisee','state':'on'},
        {'condition':'state','entity_id':'input_boolean.chauffage_absent','state':'off'},
        {'condition':'state','entity_id':ent('input_select',k,'mode'),'state':'Planning'},
        {'condition':'state','entity_id':'input_boolean.chauffage_profils_initialises','state':'on'},
        cond("{{ 5 <= states('"+ent('input_number',k,'manuel')+"') | float(-1) <= 25 and 0.5 <= states('input_number.chauffage_duree_manuelle') | float(-1) <= 12 }}"),
        call('input_number.set_value',ent('input_number',k,'cible'),{'value':"{{ states('"+ent('input_number',k,'manuel')+"') | float }}"}),
        call('input_datetime.set_datetime',ent('input_datetime',k,'fin'),{'timestamp':"{{ as_timestamp(now()) + states('input_number.chauffage_duree_manuelle') | float * 3600 }}"})]}
    pkg['script'][f'chauffage_{k}_planning']={'alias':f'{name} - reprendre le planning','mode':'single','sequence':[call('input_datetime.set_datetime',ent('input_datetime',k,'fin'),{'datetime':'2000-01-01 00:00:00'}),call('input_select.select_option',ent('input_select',k,'mode'),{'option':'Planning'})]}
    pkg['automation'].append({'id':'chauffage_mode_'+k,'alias':f'{name} - mode choisi : annuler la dérogation','mode':'restart','trigger':[{'platform':'state','entity_id':ent('input_select',k,'mode'),'not_from':['unknown','unavailable'],'not_to':['unknown','unavailable']}],'action':[call('input_datetime.set_datetime',ent('input_datetime',k,'fin'),{'datetime':'2000-01-01 00:00:00'})]})
# Schedules are UI-created helpers for graphical editing, documented in guide.
mapping={'Habituel':'schedule.chauffage_habituel','Télétravail':'schedule.chauffage_teletravail','Vacances à la maison':'schedule.chauffage_vacances_maison'}
pkg['automation'].append({'id':'chauffage_changement_planning','alias':'Chauffage - nouveau planning : annuler les dérogations','mode':'restart',
 'trigger':[{'platform':'state','entity_id':'input_select.chauffage_planning','not_from':['unknown','unavailable'],'not_to':['unknown','unavailable']}],
 'action':[zero]})
# Switching absence through any HA control must also cancel temporary room overrides.
pkg['automation'].append({'id':'chauffage_changement_absence','alias':'Chauffage - changement absence : annuler les dérogations','mode':'restart',
 'trigger':[{'platform':'state','entity_id':'input_boolean.chauffage_absent','from':'off','to':'on'}, {'platform':'state','entity_id':'input_boolean.chauffage_absent','from':'on','to':'off'}], 'action':[zero]})
states_watch=['input_boolean.chauffage_autorise','input_boolean.chauffage_configuration_initialisee','input_boolean.chauffage_profils_initialises','input_boolean.chauffage_absent','input_select.chauffage_planning']+list(mapping.values())+[ent('input_number',k,s) for k in KEYS for s in ['confort','eco','nuit','absent','cible']]+[ent('input_select',k,'mode') for k in KEYS]+ends
variables={'valve_map':{k:'climate.trv_'+k for k in KEYS},'planning_map':mapping,'planning':"{{ planning_map.get(states('input_select.chauffage_planning'), '') }}",'absent':"{{ is_state('input_boolean.chauffage_absent', 'on') }}",'tick':"{{ as_timestamp(now()) }}"}
target_template="""{% set modes = {'Confort':'confort', 'Éco':'eco', 'Nuit':'nuit', 'Absent':'absent'} %}
{% set mode = states('input_select.chauffage_' ~ repeat.item ~ '_mode') %}
{% if absent %}
  {{ states('input_number.chauffage_' ~ repeat.item ~ '_absent') | float(-1) }}
{% elif mode in modes %}
  {{ states('input_number.chauffage_' ~ repeat.item ~ '_' ~ modes[mode]) | float(-1) }}
{% elif mode != 'Planning' %} -1
{% elif as_timestamp(states('input_datetime.chauffage_' ~ repeat.item ~ '_fin'), 0) > tick | float %}
  {{ states('input_number.chauffage_' ~ repeat.item ~ '_cible') | float(-1) }}
{% elif is_state(planning, 'on') %}
  {% set profil = state_attr(planning, 'profil') | default('confort', true) %}
  {{ states('input_number.chauffage_' ~ repeat.item ~ '_' ~ profil) | float(-1) if profil in ['confort','eco','nuit','absent'] else -1 }}
{% elif is_state(planning, 'off') %}
  {{ states('input_number.chauffage_' ~ repeat.item ~ '_eco') | float(-1) }}
{% else %} -1 {% endif %}"""
apply_loop={'repeat':{'for_each':KEYS,'sequence':[{'variables':{'vanne':"{{ valve_map[repeat.item] }}",'consigne':target_template}},
 {'if':[cond("{{ states(vanne) not in ['unknown','unavailable'] and 5 <= consigne | float(-1) <= 25 }}")], 'then':[
 {'if':[cond("{{ not is_state(vanne, 'heat') }}")], 'then':[dict(call('climate.set_hvac_mode','{{ vanne }}',{'hvac_mode':'heat'}),continue_on_error=True)]},
 {'if':[cond("{{ state_attr(vanne, 'temperature') | float(-1) != consigne | float }}")], 'then':[dict(call('climate.set_temperature','{{ vanne }}',{'temperature':'{{ consigne }}'}),continue_on_error=True)]}]}]}}
pkg['automation'].append({'id':'chauffage_application_planning','alias':'Chauffage - planning, absence et dérogations','mode':'single','max_exceeded':'silent',
 'trigger':[{'platform':'state','entity_id':states_watch},{'platform':'homeassistant','event':'start'},{'platform':'time_pattern','seconds':'/15'}],
 'condition':[{'condition':'state','entity_id':'input_boolean.chauffage_autorise','state':'on'}, {'condition':'state','entity_id':'input_boolean.chauffage_configuration_initialisee','state':'on'}, {'condition':'state','entity_id':'input_boolean.chauffage_profils_initialises','state':'on'},cond("{{ states('input_boolean.chauffage_absent') in ['on','off'] }}")],
 'action':[{'variables':variables},apply_loop]})
write('chauffage-planning-exemple.yaml',pkg)

# HA dashboard: custom:button-card only, native dropdown and helper inputs.
def js(code):return '[[[ '+code+' ]]]'
def nav(path):return {'action':'navigate','navigation_path':'/chauffage-maison/'+path}
def button(name,icon,action,entity=None):
    d={'type':'custom:button-card','template':'chauffage_bouton','name':name,'icon':'mdi:'+icon,'tap_action':action}
    if entity:d['entity']=entity
    return d
def scriptbtn(name,icon,script):return button(name,icon,{'action':'call-service','service':'script.'+script})
temps_js="const n = Number(entity?.attributes?.current_temperature); return entity?.attributes?.current_temperature != null && Number.isFinite(n) ? n.toLocaleString('fr-FR',{minimumFractionDigits:1,maximumFractionDigits:1})+' °C' : '—';"
row={'show_label':True,'show_state':False,'triggers_update':'all','tap_action':nav('accueil'),
 'label':js(temps_js), 'custom_fields':{'consigne':js("const n=Number(entity?.attributes?.temperature); return entity?.attributes?.temperature != null && Number.isFinite(n) ? n.toLocaleString('fr-FR')+'°' : '—';"),
 'statut':js("if (!entity || ['unavailable','unknown'].includes(entity.state)) return 'Indisponible'; const heat=entity.attributes.hvac_action==='heating'?'En chauffe':(['idle','off'].includes(entity.attributes.hvac_action)?'Au repos':'État inconnu'); if(states['input_boolean.chauffage_autorise']?.state!=='on') return 'Chauffage arrêté'; if(states['input_boolean.chauffage_absent']?.state==='on') return 'Maison absente · '+heat; const mode=states['input_select.chauffage_'+variables.room_key+'_mode']?.state; if(mode && mode!=='Planning') return mode+' · '+heat; const end=Number(states['input_datetime.chauffage_'+variables.room_key+'_fin']?.attributes?.timestamp); return (end*1000>Date.now()?'Manuel · ':'')+heat;")},
 'styles':{'card':[{'border-radius':'20px'},{'padding':'16px'},{'box-shadow':'none'},{'border':'none'},{'background':'var(--ha-card-background, var(--card-background-color))'}],
 'grid':[{'grid-template-areas':'"i n consigne" "i l consigne" "i statut statut"'},{'grid-template-columns':'54px 1fr 64px'},{'column-gap':'14px'}],
 'icon':[{'width':'27px'},{'color':js("return entity?.attributes?.hvac_action==='heating' ? '#e77829' : 'var(--secondary-text-color)';")}],
 'img_cell':[{'background':js("return entity?.attributes?.hvac_action==='heating' ? '#fff0e4' : 'var(--secondary-background-color)';")},{'border-radius':'18px'},{'width':'54px'},{'height':'58px'}],
 'name':[{'justify-self':'start'},{'font-size':'16px'},{'font-weight':'600'}],
 'label':[{'justify-self':'start'},{'font-size':'17px'},{'margin-top':'4px'}],
 'custom_fields':{'consigne':[{'background':'#406bfa'},{'color':'white'},{'padding':'14px 4px'},{'border-radius':'16px'},{'font-size':'18px'}],
 'statut':[{'justify-self':'start'},{'font-size':'12px'},{'color':'var(--secondary-text-color)'},{'margin-top':'5px'}]}}}
templates={'chauffage_piece':row,'chauffage_bouton':{'styles':{'card':[{'border-radius':'18px'},{'padding':'14px 8px'},{'box-shadow':'none'}],'icon':[{'color':'#406bfa'},{'width':'24px'}],'name':[{'font-size':'12px'},{'margin-top':'8px'},{'white-space':'normal'}]}}}
header={'type':'custom:button-card','name':'Ma maison','icon':'mdi:home-thermometer-outline','show_label':True,'triggers_update':'all','tap_action':{'action':'none'},
 'label':js("if (states['input_boolean.chauffage_autorise']?.state!=='on') return 'Chauffage arrêté'; if (states['input_boolean.chauffage_absent']?.state==='on') return 'Maison absente · consignes par pièce'; return states['input_select.chauffage_planning']?.state ?? 'Choisir un planning';"),
 'custom_fields':{'etat':js("const r=states['switch.relais_chaudiere']?.state; return r==='on' ? 'Demande chaudière active' : r==='off' ? 'Chaudière : demande arrêtée' : 'Relais indisponible';")},
 'styles':{'card':[{'background':'linear-gradient(140deg, #192778, #4074ff)'},{'color':'white'},{'border-radius':'0 0 28px 28px'},{'padding':'28px 22px'},{'border':'none'}],
 'grid':[{'grid-template-areas':'"n i" "l l" "etat etat"'},{'grid-template-columns':'1fr 44px'}],
 'name':[{'font-size':'25px'},{'font-weight':'600'},{'justify-self':'start'}], 'icon':[{'color':'white'},{'width':'30px'}],
 'label':[{'justify-self':'start'},{'margin-top':'22px'},{'font-size':'16px'}], 'custom_fields':{'etat':[{'justify-self':'start'},{'font-size':'13px'},{'margin-top':'8px'}]}}}
absbtn=button('Absent','home-export-outline',{'action':'call-service','service':'script.chauffage_basculer_absence'},'input_boolean.chauffage_absent')
absbtn.update({'state':[{'value':'on','styles':{'card':[{'background':'#fff0e4'}],'icon':[{'color':'#b34c08'}]},'name':'Absent ✓'}],'styles':{'card':[{'height':'115px'}]}})
select={'type':'tile','entity':'input_select.chauffage_planning','name':'Mon planning','hide_state':True,'icon':'mdi:calendar-clock','features':[{'type':'select-options'}]}
picker={'type':'custom:button-card','show_name':False,'show_icon':False,'tap_action':{'action':'none'},'custom_fields':{'planning':{'card':select},'absent':{'card':absbtn}},
 'styles':{'card':[{'background':'none'},{'box-shadow':'none'},{'border':'none'},{'padding':'0'}], 'grid':[{'grid-template-areas':'"planning absent"'},{'grid-template-columns':'minmax(0, 1fr) 94px'},{'column-gap':'10px'}],'custom_fields':{'planning':[{'min-width':'0'}],'absent':[{'align-self':'stretch'}]}}}
def navbar():return {'type':'horizontal-stack','cards':[button('Accueil','home-outline',nav('accueil')),button('Plannings','calendar-clock',nav('plannings')),button('Réglages','cog-outline',nav('reglages'))]}
cards=[header,picker,{'type':'markdown','content':'### Mes pièces\nTouchez une pièce pour régler sa température.'}]
for key,name,icon in ROOMS:
    cards.append({'type':'custom:button-card','template':'chauffage_piece','variables':{'room_key':key},'entity':'climate.trv_'+key,'name':name,'icon':'mdi:'+icon,'tap_action':nav(key)})
cards += [{'type':'markdown','content':"**Salle de bain** · Radiateur toujours ouvert. Chauffe lorsque la chaudière fait circuler l’eau chaude."},navbar()]
dash={'title':'Ma maison','button_card_templates':templates,'views':[{'title':'Accueil','path':'accueil','icon':'mdi:home','type':'masonry','cards':[{'type':'vertical-stack','cards':cards}]}]}
def entities(title,ents):return {'type':'entities','title':title,'show_header_toggle':False,'entities':ents}
planning_cards=[{'type':'custom:chauffage-planning-card','schedules':[{'name':name,'entity':entity} for name,entity in mapping.items()]},
 {'type':'markdown','content':"Chaque plage choisit **Confort, Éco, Nuit ou Absent**. Les températures correspondantes sont réglables dans chaque pièce. Hors plage : Éco. Le mode permanent d’une pièce reste prioritaire sur le planning. L’édition ne change pas le planning actif ; sélectionnez-le sur l’accueil."},
 scriptbtn('Annuler les consignes temporaires','calendar-check','chauffage_annuler_derogations'),navbar()]
dash['views'].append({'title':'Plannings','path':'plannings','icon':'mdi:calendar-clock','cards':[{'type':'vertical-stack','cards':planning_cards}]})
settings=[entities('Chauffage',['input_boolean.chauffage_autorise','input_number.chauffage_duree_manuelle']),
 {'type':'markdown','content':"**Absent** réduit les consignes ; il ne coupe pas le chauffage. **Chauffage autorisé** doit rester actif pour chauffer. Les réglages manuels s’appliquent depuis la fiche de chaque pièce. Ils survivent au redémarrage jusqu’à leur échéance."},
 {'type':'conditional','conditions':[{'entity':'input_boolean.chauffage_configuration_initialisee','state':'off'}],'card':scriptbtn('Initialiser les températures','cog-play-outline','chauffage_initialiser')},
 {'type':'conditional','conditions':[{'entity':'input_boolean.chauffage_configuration_initialisee','state':'on'},{'entity':'input_boolean.chauffage_profils_initialises','state':'off'}],'card':scriptbtn('Initialiser Nuit et Absent','cog-play-outline','chauffage_initialiser_nouveaux_profils')},navbar()]
dash['views'].append({'title':'Réglages','path':'reglages','icon':'mdi:cog','cards':[{'type':'vertical-stack','cards':settings}]})
for key,name,icon in ROOMS:
    info={'type':'custom:button-card','template':'chauffage_piece','variables':{'room_key':key},'entity':'climate.trv_'+key,'name':name,'icon':'mdi:'+icon,'tap_action':{'action':'none'}}
    apply_button=scriptbtn('Appliquer','check','chauffage_'+key+'_appliquer')
    apply_button['triggers_update']='all'
    can_apply="states['input_boolean.chauffage_autorise']?.state==='on' && states['input_boolean.chauffage_profils_initialises']?.state==='on' && states['input_boolean.chauffage_absent']?.state==='off' && states['input_select.chauffage_"+key+"_mode']?.state==='Planning'"
    apply_button['tap_action']['action']=js('return '+can_apply+" ? 'call-service' : 'none';")
    apply_button['styles']={'card':[{'opacity':js('return '+can_apply+' ? 1 : 0.4;')}]}
    roomcards=[info,entities('Mode de la pièce',[ent('input_select',key,'mode')]),entities('Les quatre températures',[ent('input_number',key,s) for s in ['confort','eco','nuit','absent']]),entities('Réglage temporaire',[{'entity':ent('input_number',key,'manuel'),'name':'Température souhaitée'},'input_number.chauffage_duree_manuelle',{'entity':ent('input_datetime',key,'fin'),'type':'simple-entity','name':'Fin de la dérogation'}]),
      {'type':'horizontal-stack','cards':[apply_button,scriptbtn('Reprendre le planning','calendar-check','chauffage_'+key+'_planning')]},
      {'type':'markdown','content':"**Planning** suit les horaires. **Confort, Éco, Nuit ou Absent** maintiennent le profil de cette pièce jusqu’à votre changement. Exemple : Absent pour une chambre inoccupée.\n\nLa consigne temporaire est disponible en mode Planning, hors absence de toute la maison. **Reprendre le planning** rétablit le suivi des horaires de cette pièce."},navbar()]
    dash['views'].append({'title':name,'path':key,'subview':True,'cards':[{'type':'vertical-stack','cards':roomcards}]})
write('chauffage-tableau-de-bord.yaml',dash)
print('Planning et tableau de bord générés : 8 pièces, 3 plannings, absence, dérogations persistantes.')
