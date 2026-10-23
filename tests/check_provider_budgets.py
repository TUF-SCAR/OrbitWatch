"""Provider stress tests use isolated SQLite reservations and mock HTTP only."""
import sys,json,tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from services.providers.budget import ProviderBudget,ProviderDeferred
if len(sys.argv)>2 and sys.argv[1]=='--child':
    try:
        ProviderBudget(sys.argv[2],clock=lambda:10000,jitter=lambda:30).reserve('spacetrack',3600,2)
        print('won')
    except ProviderDeferred: print('deferred')
    raise SystemExit
with tempfile.TemporaryDirectory(dir=ROOT/'.orbitwatch-backups') as tmp:
 clock=[10000.0];path=Path(tmp)/'budgets.db';budget=ProviderBudget(path,clock=lambda:clock[0],jitter=lambda:30)
 with budget.connect(): pass
 def claim(_):
  try: ProviderBudget(path,clock=lambda:clock[0],jitter=lambda:30).reserve('spacetrack',3600,2);return True
  except ProviderDeferred: return False
 with ThreadPoolExecutor(max_workers=10) as workers: assert sum(workers.map(claim,range(40)))==1
 counts={'simulatedSeconds':600,'mockSpaceTrackLogin':1,'mockSpaceTrackBulkGP':1,'mockCelesTrakBulk':0,'realExternalProviderRequests':0}
 for second in range(0,600,60):
  clock[0]=10000+second
  assert not claim(0)
 # Persisted reservations survive a new instance/process and force-style calls.
 new=ProviderBudget(path,clock=lambda:clock[0],jitter=lambda:30)
 try: new.reserve('spacetrack',3600,2);raise AssertionError('restart bypassed reservation')
 except ProviderDeferred: pass
 response=SimpleNamespace(status_code=429,headers={'Retry-After':'14400'})
 budget.finish('spacetrack',3600,SimpleNamespace(response=response))
 clock[0]+=7200
 assert not claim(0),'Retry-After must exceed normal interval'
 budget.reserve('celestrak',7200,1)
 counts['mockCelesTrakBulk']=1
 budget.finish('celestrak',7200,SimpleNamespace(response=SimpleNamespace(status_code=503,headers={})))
 clock[0]+=86400
 try: budget.reserve('celestrak',7200,1);raise AssertionError('non-200 circuit must require human intervention')
 except ProviderDeferred: pass
 target=ROOT/'.orbitwatch-backups/provider-usage-workload.json';target.write_text(json.dumps(counts,indent=2))
 print('PASS: concurrent persistent reservations,10-minute multi-worker workload,429/Retry-After,circuit policy;',counts)

from unittest.mock import patch
import os,httpx
with tempfile.TemporaryDirectory(dir=ROOT/'.orbitwatch-backups') as tmp:
    clock=[10000.0];local=ProviderBudget(Path(tmp)/'http.db',clock=lambda:clock[0],jitter=lambda:30)
    calls={'login':0,'gp':0,'celestrak':0}
    class MockClient:
        def post(self,path,**kwargs):
            calls['login']+=1
            return httpx.Response(200,json={'Login':'Success'},request=httpx.Request('POST','https://www.space-track.org'+path))
        def get(self,path,**kwargs):
            calls['gp']+=1;return httpx.Response(200,json=[{'NORAD_CAT_ID':'25544'}],request=httpx.Request('GET','https://www.space-track.org'+path))
        def close(self):pass
    def fake_celestrak(**kwargs):
        calls['celestrak']+=1
        return httpx.Response(200,text='',request=httpx.Request('GET','https://celestrak.org/NORAD/elements/gp.php'))
    with patch.dict(os.environ,{'SPACETRACK_USERNAME':'isolated-fixture','SPACETRACK_PASSWORD':'not-a-real-credential'}),patch('dotenv.load_dotenv',return_value=False):
        from services.providers import spacetrack,celestrak
    with patch.object(spacetrack,'budget',local),patch.object(celestrak,'budget',local),patch('httpx.Client',return_value=MockClient()),patch('httpx.get',side_effect=fake_celestrak):
        for second in range(0,600,15):
            clock[0]=10000+second
            for provider in [spacetrack,celestrak]:
                try:provider.get_latest_gp([25544,20580])
                except ProviderDeferred:pass
    assert calls=={'login':1,'gp':1,'celestrak':1},calls
    print('PASS: production provider mock HTTP10-minute counts',calls,'real external requests0')

import subprocess
with tempfile.TemporaryDirectory(dir=ROOT/'.orbitwatch-backups') as tmp:
    path=Path(tmp)/'process.db'
    with ProviderBudget(path).connect():pass
    def child(_):
        result=subprocess.run([sys.executable,__file__,'--child',str(path)],capture_output=True,text=True,check=True)
        return result.stdout.strip()=='won'
    with ThreadPoolExecutor(max_workers=4) as pool: assert sum(pool.map(child,range(4)))==1
    print('PASS: four separate processes share exactly one reservation')

from services.providers.budget import ProviderAuthorizationError
with tempfile.TemporaryDirectory(dir=ROOT/'.orbitwatch-backups') as tmp:
    auth=ProviderBudget(Path(tmp)/'auth.db',clock=lambda:10000,jitter=lambda:0)
    auth.reserve('spacetrack',3600,2);auth.finish('spacetrack',3600,ProviderAuthorizationError('isolated rejected login'))
    try:auth.reserve('spacetrack',3600,2);raise AssertionError('rejected authentication must require investigation')
    except ProviderDeferred:pass
print('PASS: logical HTTP200 authentication rejection opens a manual circuit')
