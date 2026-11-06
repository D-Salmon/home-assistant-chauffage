import sys, json, datetime, ast
from pathlib import Path
import yaml
from jinja2.nativetypes import NativeEnvironment
from jinja2 import StrictUndefined

ROOT = Path(__file__).parent.parent / 'configuration'
class Input(str): pass
class Loader(yaml.SafeLoader): pass
Loader.add_constructor('!input', lambda l, n: Input(l.construct_scalar(n)))
doc = yaml.load((ROOT/'chauffage-trv-blueprint.yaml').read_text(encoding='utf-8'), Loader=Loader)
plan = yaml.safe_load((ROOT/'chauffage-planning-exemple.yaml').read_text(encoding='utf-8'))
example = yaml.safe_load((ROOT/'chauffage-trv-exemple.yaml').read_text(encoding='utf-8'))
env = NativeEnvironment(undefined=StrictUndefined)
env.filters['from_json'] = lambda s, default=None: from_json(s, default)
env.filters['to_json'] = lambda x: json.dumps(x, ensure_ascii=False)
def from_json(s, default):
    try: return json.loads(s)
    except (ValueError, TypeError): return default
def timestamp(x, default=None):
    try:
        if isinstance(x, (int, float)): return x
        if isinstance(x, datetime.datetime): return x.timestamp()
        return datetime.datetime.fromisoformat(x.replace('Z','+00:00')).timestamp()
    except (ValueError, TypeError, AttributeError): return default

inputs = {k: v.get('default') for k,v in doc['blueprint']['input'].items()}
inputs.update(valves=['climate.v'+str(i) for i in range(8)], relay='switch.boiler', enable='input_boolean.enable', memory='input_text.memo')

class Sim:
    def __init__(self):
        self.t = 1800000000
        self.states = {v:'heat' for v in inputs['valves']}
        self.states.update({'switch.boiler':'off','input_boolean.enable':'on','input_text.memo':''})
        self.attrs = {v:{'hvac_action':'idle'} for v in inputs['valves']}
        self.context = None
    def tick(self, dt=0, trigger='poll', acknowledge=True, override=None):
        self.t += dt
        values = dict(inputs)
        if override: values.update(override)
        ctx = dict(trigger={'id':trigger}, this={'entity_id':'automation.test'},
                   states=lambda e:self.states.get(e,'unknown'),
                   state_attr=lambda e,a:self.attrs.get(e,{}).get(a),
                   is_state=lambda e,s:self.states.get(e)==s,
                   now=lambda:datetime.datetime.fromtimestamp(self.t, datetime.timezone.utc),
                   as_timestamp=timestamp)
        for action in doc['action']:
            if 'variables' not in action: break
            for k,v in action['variables'].items():
                if isinstance(v,Input): result = values[str(v)]
                elif isinstance(v,str): result = env.from_string(v).render(**ctx)
                else: result = v
                if isinstance(result,str):
                    result=result.strip()
                    try: result=ast.literal_eval(result)
                    except (ValueError,SyntaxError): pass
                ctx[k] = result
        assert isinstance(ctx['wanted'], bool)
        assert isinstance(ctx['send'], bool)
        assert ctx['target'] in ['on','off']
        assert isinstance(ctx['next_memory'],str)
        assert len(ctx['next_memory']) <= 255
        self.states['input_text.memo'] = ctx['next_memory']
        if ctx['send'] and acknowledge: self.states['switch.boiler'] = ctx['target']
        self.context = ctx
        return ctx
    def heat(self,i=0): self.attrs['climate.v'+str(i)]['hvac_action']='heating'
    def idle(self,i=0): self.attrs['climate.v'+str(i)]['hvac_action']='idle'

# Idle startup, qualification, minimum OFF, maintained heat, qualified stop.
s=Sim(); assert s.tick(trigger='startup')['target']=='off'
s.heat(); assert s.tick(15)['target']=='off'
assert s.tick(30)['target']=='off'
assert s.tick(135)['target']=='on'
assert s.tick(15)['send'] is False
s.idle(); assert s.tick(1)['target']=='on'
assert s.tick(29)['target']=='on'
assert s.tick(1)['target']=='off'
s.tick(15); s.heat(); assert s.tick(15)['target']=='off'
assert s.tick(165)['target']=='on'

# A short demand never starts the relay.
s=Sim(); s.tick(trigger='startup'); s.tick(200); s.heat(); s.tick(); s.idle()
assert s.tick(15)['target']=='off'

# One unavailable TRV does not cancel a healthy demand; all invalid stop promptly.
s=Sim(); s.heat(); s.tick(trigger='startup'); s.tick(180)
s.states['climate.v1']='unavailable'; assert s.tick(15)['target']=='on'
s.states['climate.v0']='unavailable'; assert s.tick(1)['target']=='off'
assert s.context['fault_count']==2

# Missing action is not silently interpreted as idle.
s=Sim(); s.attrs['climate.v0']={}; assert s.tick()['fault_count']==1

# Master stop overrides all timers.
s=Sim(); s.heat(); s.tick(trigger='startup'); s.tick(180)
s.states['input_boolean.enable']='off'; assert s.tick(1)['target']=='off'

# At most 3 commands; no retry flood; recovery resets the counter.
s=Sim(); s.heat(); s.tick(trigger='startup'); s.tick(180,acknowledge=False)
assert not s.tick(1,acknowledge=False)['send']
assert s.tick(14,acknowledge=False)['send']
assert s.tick(15,acknowledge=False)['send']
assert not s.tick(15,acknowledge=False)['send']
assert s.context['attempts']==3
s.states['switch.boiler']='unavailable'; s.tick(15,acknowledge=False)
s.states['switch.boiler']='off'; assert s.tick(15)['target']=='off'
assert s.tick(180)['target']=='on'

# A restart with an OFF relay requalifies start and observes a fresh OFF interval.
s=Sim(); s.tick(trigger='startup'); s.tick(200); s.heat(); s.tick()
assert s.tick(10,trigger='startup')['target']=='off'
assert s.tick(180)['target']=='on'

# Demand continuity survives normal polling; malformed memory is recovered.
s=Sim(); s.states['input_text.memo']='v1:[]'; s.heat(); s.tick(trigger='startup')
assert s.tick(180)['target']=='on'

# A stale heating status cannot keep the relay on when freshness is enabled.
s=Sim(); s.heat(); s.tick(trigger='startup'); s.tick(180)
mapping={v:'sensor.seen'+str(i) for i,v in enumerate(inputs['valves'])}
for e in mapping.values(): s.states[e]=datetime.datetime.fromtimestamp(s.t-8000,datetime.timezone.utc).isoformat()
assert s.tick(1,override={'last_seen_map':mapping})['target']=='off'
assert s.context['fault_count']==8

# Native Jinja compilation of ALL templates, including notification branches.
def walk(v):
    if isinstance(v,dict):
        for item in v.values(): walk(item)
    elif isinstance(v,list):
        for item in v: walk(item)
    elif isinstance(v,str) and ('{{' in v or '{%' in v): env.from_string(v)
walk(doc); walk(plan)

# Evaluate priorities, including an expired override after HA restart.
planner=next(a for a in plan['automation'] if a['id']=='chauffage_application_planning')
tpl=env.from_string(planner['action'][1]['repeat']['sequence'][0]['variables']['consigne'])
def setpoint(absent=False,active='off',expiry=0,tick=1800000000,mode='Planning',profile=None):
    states={'schedule.test':active,'input_number.chauffage_salon_confort':'20',
            'input_number.chauffage_salon_eco':'17','input_number.chauffage_salon_absent':'13',
            'input_number.chauffage_salon_nuit':'18','input_select.chauffage_salon_mode':mode,
            'input_number.chauffage_salon_cible':'22',
            'input_datetime.chauffage_salon_fin':datetime.datetime.fromtimestamp(expiry,datetime.timezone.utc).isoformat()}
    return float(tpl.render(absent=absent,planning='schedule.test',repeat={'item':'salon'},tick=tick,as_timestamp=timestamp,states=lambda e:states.get(e,'unknown'),is_state=lambda e,v:states.get(e)==v,state_attr=lambda e,a:profile if a=='profil' else None))
assert setpoint()==17
assert setpoint(active='on')==20
assert setpoint(absent=True,active='on')==13
assert setpoint(absent=True,active='off',expiry=1800010000)==13
assert setpoint(expiry=1800010000)==22
assert setpoint(expiry=1800010000,active='on')==22
assert setpoint(expiry=1800000000)==17
assert setpoint(expiry=1800010000,tick=1800020000)==17
assert setpoint(active='unknown')==-1
assert setpoint(active='unavailable',expiry=1800010000)==22
for profile,expected in [('confort',20),('eco',17),('nuit',18),('absent',13)]:
    assert setpoint(active='on',profile=profile)==expected
for mode,expected in [('Confort',20),('Éco',17),('Nuit',18),('Absent',13)]:
    assert setpoint(active='on',mode=mode,expiry=1800010000)==expected
    assert setpoint(active='unavailable',mode=mode)==expected
assert setpoint(absent=True,mode='Confort')==13
assert setpoint(active='on',mode='Absent',profile='confort')==13
assert setpoint(active='on',profile='invalid')==-1
assert setpoint(mode='unavailable')==-1
assert len(example['automation'][0]['use_blueprint']['input']['valves'])==8
assert len(planner['action'][1]['repeat']['for_each'])==8
assert not any(t.get('entity_id','').startswith('climate.') for t in planner['trigger'] if isinstance(t.get('entity_id'),str))
# Card routes and entity references must resolve to actual definitions/placeholders.
dashboard=yaml.safe_load((ROOT/'chauffage-tableau-de-bord.yaml').read_text(encoding='utf-8'))
routes={'/chauffage-maison/'+v['path'] for v in dashboard['views']}
known={d+'.'+k for d in ['input_boolean','input_number','input_datetime','input_select','input_text','script'] for obj in [plan,example] for k in obj.get(d,{})}
known.update(planner['action'][0]['variables']['valve_map'].values())
known.update(planner['action'][0]['variables']['planning_map'].values())
known.add('switch.relais_chaudiere')
js_templates=[]
def check_ui(v):
    if isinstance(v,dict):
        if 'navigation_path' in v:assert v['navigation_path'] in routes|{'/config/helpers'},v
        if isinstance(v.get('entity'),str):assert v['entity'] in known,v
        if str(v.get('service','')).startswith('script.'):assert v['service'] in known,v
        for x in v.values():check_ui(x)
    elif isinstance(v,list):
        for x in v:check_ui(x)
    elif isinstance(v,str) and v.startswith('[[['):js_templates.append(v[3:-3].strip())
check_ui(dashboard)
assert len(dashboard['views'])==11
assert len(plan['input_datetime'])==8
# Every manual script copies its draft and uses a timestamp, not a volatile timer.
for k in planner['action'][1]['repeat']['for_each']:
    seq=plan['script']['chauffage_'+k+'_appliquer']['sequence']
    assert seq[0]['entity_id']=='input_boolean.chauffage_autorise'
    assert seq[2]['state']=='off'
    assert seq[-2]['target']['entity_id']=='input_number.chauffage_'+k+'_cible'
    assert 'timestamp' in seq[-1]['data']
    assert 'initial' not in plan['input_datetime']['chauffage_'+k+'_fin']
(ROOT.parent/'tests'/'.generated').mkdir(exist_ok=True)
(ROOT.parent/'tests'/'.generated'/'dashboard-js.json').write_text(json.dumps(js_templates),encoding='utf-8')
assert len([k for k in plan['input_number'] if k.endswith(('_confort','_eco','_nuit','_absent'))])==32
print('PASS: YAML, Jinja, chaudière, 4 profils par pièce, absence permanente, dérogations, mémoire, routes et entités de 11 vues.')
print('Simulation hors HA : validation native HA et essais du matériel restent nécessaires.')
