import contextlib,hashlib,json,os,re,runpy,shutil,sys
from collections import Counter
from pathlib import Path
root=Path('/mnt/fast/tmp/codex-2073-review-dfbb0a07-thinking-off')
profile=Path('/mnt/fast/tmp/codex-2073-profile-dfbb0a07-thinking-off')
original=Path.home()/'.pi/agent'
watched=[original/n for n in ['models.json','auth.json','settings.json']]
before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in watched if p.exists()}
if not profile.exists():
 profile.mkdir(mode=0o700)
 for name in ['models.json','auth.json']:
  shutil.copyfile(original/name,profile/name);os.chmod(profile/name,0o600)
 (profile/'settings.json').write_text('{}\n');os.chmod(profile/'settings.json',0o600)
os.environ.update(PI_CODING_AGENT_DIR=str(profile),PI_OFFLINE='1',PI_TELEMETRY='0',AI_ROUTE_HOST_MAX='3',AI_ROUTE_MAC_MAX='3')
router=runpy.run_path('/home/ian/.local/bin/ai-route',run_name='cairn_scoped_json_router')
g=router['run'].__globals__;original_cache=Path(g['CACHE']);cache=root/'route-cache';cache.mkdir(exist_ok=True)
for name in ['codex','grok','commandcode']:
 p=original_cache/(name+'.json')
 if p.exists():shutil.copy2(p,cache/p.name)
allowed={'glm-5.3','glm-5.3-flash','deepseek-v4.1-flash'}
prior=set(json.loads((original_cache/'pi.json').read_text()))
providers=json.loads((profile/'models.json').read_text())['providers']
qualified={f'{provider}/{m["id"]}':m['contextWindow'] for provider,data in providers.items() for m in data.get('models',[]) if m.get('id') in allowed and m.get('contextWindow',0)>=1000000 and f'{provider}/{m["id"]}' in prior}
if not qualified:raise SystemExit('No approved 1M candidates')
def probe(host=None):
 if host is not None:raise RuntimeError('Local diagnostic only')
 good=[]
 for model in qualified:
  _,err=router['ping_pi'](model)
  print(json.dumps({'probe':model,'passed':err is None}),flush=True)
  if err is None:good.append(model)
 return good
original_candidates=router['candidates']
def candidates(role,st,hard,host=None):
 return [(kind,model) for kind,model in original_candidates(role,st,hard,host) if kind=='pi' and model in qualified]
original_build=router['build_cmd'];active_model=None

def build(kind,model,role,prompt,cwd,host=None):
 global active_model
 active_model=model
 argv=original_build(kind,model,role,prompt,cwd,host)
 return argv[:-1]+['--mode','json','--no-mcp','--no-skills','--no-context-files','--no-approve','--tools','read,grep,find,ls']+[argv[-1]]

class JsonVerdicts:
 final_text=None
 reports=[]
 def __getattr__(self,name):return getattr(re,name)
 def search(self,pattern,value,*args,**kwargs):
  if 'VERDICT:' not in pattern:return re.search(pattern,value,*args,**kwargs)
  (root/('candidate-'+str(active_model).replace('/','--')+'.private.jsonl')).write_text(value)
  counts=Counter();last=None;settled=False;aborted=None;valid=True
  for line in value.split('\n'):
   if not line.strip():continue
   try:event=json.loads(line)
   except json.JSONDecodeError:valid=False;continue
   counts[event.get('type')]+=1
   if event.get('type')=='message_end' and event.get('message',{}).get('role')=='assistant':last=event['message']
   if event.get('type')=='agent_settled':settled=True;aborted=event.get('aborted')
  text='\n'.join(block.get('text','') for block in (last or {}).get('content',[]) if block.get('type')=='text')
  stop=(last or {}).get('stopReason')
  match=re.search(pattern,text,*args,**kwargs) if valid and settled and aborted is False and stop=='stop' else None
  report={'model':active_model,'contextWindow':qualified.get(active_model),'events':dict(counts),'settled':settled,'aborted':aborted,'stopReason':stop,'thinkingLevel':(last or {}).get('thinkingLevel'),'textChars':len(text),'validVerdict':bool(match),'smokeOnly':False,'sourceReview':True}
  self.reports.append(report)
  (root/'stream-summary.json').write_text(json.dumps(self.reports,indent=2)+'\n')
  if match:self.final_text=text
  return match

adapter=JsonVerdicts();g['ROLES']['review']['thinking']='off';g.update(CACHE=str(cache),probe_pi=probe,candidates=candidates,build_cmd=build,re=adapter)

slot=router['host_slot']('mac',3);os.environ['AI_ROUTE_NO_SLOT']='1'
rc=1
try:
 with (root/'router-output.private.log').open('w') as out,(root/'router-errors.private.log').open('w') as err,contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
  try:router['main'](['run','review','-C',str(root),'--hard',(root/'request.txt').read_text()])
  except SystemExit as result:rc=result.code if isinstance(result.code,int) else 1
 if rc==0 and adapter.final_text:print(adapter.final_text,flush=True)
 print(json.dumps({'sourceCommit':'dfbb0a07ed2c7a4d658cdde3b1b60dbe9b0eef00','sourceReviewReports':adapter.reports,'exitCode':rc}),flush=True)
finally:
 if slot and Path(slot).exists():Path(slot).unlink()
 after={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in watched if p.exists()}
 integrity={'unchanged':before==after,'changedFiles':[name for name in before.keys()|after.keys() if before.get(name)!=after.get(name)],'isolatedAgentDirectory':str(profile)}
 (root/'config-integrity.json').write_text(json.dumps(integrity,indent=2)+'\n')
 print(json.dumps({'globalConfigurationIntegrity':integrity}),flush=True)
sys.exit(rc)
