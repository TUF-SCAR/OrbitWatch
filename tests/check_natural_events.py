"""Isolated real route/cache tests. Zero provider HTTP / production DB access."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone,timedelta
import copy,json,os,sys,tempfile,threading,time
from pathlib import Path
from unittest.mock import patch
import httpx
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'backend'))


def run():
 with tempfile.TemporaryDirectory(dir=ROOT/'.orbitwatch-backups') as tmp,patch('dotenv.load_dotenv',return_value=False),patch.dict(os.environ,{
  'DATABASE_URL':f'sqlite:///{Path(tmp).as_posix()}/accounts.db','JWT_SECRET_KEY':'isolated-event-contract-secret-with-sufficient-length','ORBITWATCH_INGESTION_ENABLED':'false','ORBITWATCH_EVENTS_CACHE_DIR':str(Path(tmp)/'events')}):
  from services.natural_event_data import normalize,safe_url,geometry,cross_references,iso
  from services import natural_events as n
  from services.weather_cache import WeatherDeferred
  from core.database import DatabaseBase,database_engine,database_session_maker
  from core.availability import DatabaseUnavailable
  from models.user import User
  from services.auth import hash_password,create_access_token
  from main import app
  from fastapi.testclient import TestClient
  DatabaseBase.metadata.create_all(database_engine)
  now=datetime.now(timezone.utc);stamp=iso(now)
  row={'id':'EONET_test','title':'Tropical Cyclone Test','closed':None,'categories':[{'id':'severeStorms'}],'sources':[],
   'link':'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_test','description':'<script>not executable</script>Plain report',
   'geometry':[{'date':stamp,'type':'Point','coordinates':[179,12],'magnitudeValue':60,'magnitudeUnit':'kts'}]}
  data={'events':[row]};es,bad=normalize('eonet',data,stamp);assert bad==0 and len(es)==1 and es[0]['category']=='cyclone'
  fraction=copy.deepcopy(row);second=now.replace(microsecond=0);fraction['geometry']=[{'date':iso(second+timedelta(microseconds=500000)),'type':'Point','coordinates':[11,22]},{'date':iso(second),'type':'Point','coordinates':[10,20]}]
  assert normalize('eonet',{'events':[fraction]},stamp)[0][0]['position']==[11,22]
  assert es[0]['danger_radius_km'] is None and es[0]['track'] is None and 'does not imply' in es[0]['status_meaning']
  assert '<script>' not in es[0]['description'];assert es[0]['measurements'][0]['units']=='kts'
  for url in ['javascript:alert(1)','https://user:pass@example.com/a','http://127.0.0.1/a','http://localhost/a','data:text/html,test'] :assert safe_url(url) is None
  polygon={'type':'Polygon','coordinates':[[[179,10],[-179,10],[-179,12],[179,10]]]};assert geometry(polygon)==polygon
  assert geometry({'type':'Polygon','coordinates':[[[0,0],[1,1],[2,2],[3,3]]]}) is None
  assert geometry({'type':'Point','coordinates':[1,float('nan')]}) is None
  invalid=copy.deepcopy(row);invalid['geometry'][0]['coordinates']=[190,12]
  ancient=copy.deepcopy(row);ancient['id']='old';ancient['geometry'][0]['date']=iso(now-timedelta(days=40))
  future=copy.deepcopy(row);future['id']='future';future['geometry'][0]['date']=iso(now+timedelta(days=2))
  parsed,rejected=normalize('eonet',{'events':[row,row,invalid,ancient,future]},stamp);assert len(parsed)==1 and rejected==3
  empty,rejected=normalize('eonet',{'events':[]},stamp);assert empty==[]
  quake={'id':'q1','properties':{'type':'earthquake','title':'Real-contract fixture','time':now.timestamp()*1000,'mag':4.5,'magType':'mb','status':'reviewed','url':'https://earthquake.usgs.gov/earthquakes/eventpage/q1'},'geometry':{'type':'Point','coordinates':[10,20,33]}}
  q=normalize('usgs',{'features':[quake]},stamp)[0][0];assert q['measurements'][1]=={'label':'Hypocentral depth','value':33,'units':'km'}
  events=cross_references(es+[q]);assert len(events)==2 and events[0]['related_ids']==[]
  gdacs={'features':[{'geometry':{'type':'Point','coordinates':[123,12]},'properties':{'eventtype':'VO','eventid':123,'name':'Source volcano fixture','todate':stamp,'episodeid':7,'episodealertlevel':'Green','severitydata':{'severity':0,'severityunit':'','severitytext':''}}}]}
  volcano=normalize('gdacs',gdacs,stamp)[0][0];assert volcano['measurements']==[] and volcano['provider_event_id']=='123' and volcano['episode_status']=='Green'
  bad_update=copy.deepcopy(gdacs);bad_update['features'][0]['properties']['datemodified']=iso(now+timedelta(days=1))
  assert normalize('gdacs',bad_update,stamp)[0]==[] # Future update cannot make an old event appear recent.
  missing_id=copy.deepcopy(gdacs);missing_id['features'][0]['properties'].pop('eventid')
  assert normalize('gdacs',missing_id,stamp)[0]==[] # Never invent a provider identity such as VO:None.
  linked={**es[0],'references':[{'url':q['source_url']}]};assert cross_references([linked,q])[0]['related_ids']==['usgs:q1']
  print('PASS normalization: geometry/dateline, missing values, magnitude/depth units, curation semantics, source security, duplicate IDs, empty/stale/future reports and conservative relations')
  # One request per provider despite concurrent consumers; independent jobs and
  # backoff. Reuse the genuine route/auth machinery with disposable accounts.
  with database_session_maker() as session:
   user=User(username='events_test',email='events@example.invalid',password_hash=hash_password('isolated-password'));session.add(user);session.commit();token=create_access_token(user.id)
  headers={'Authorization':'Bearer '+token};client=TestClient(app)
  assert client.get('/api/events').status_code==401
  assert client.get('/api/events/eonet:EONET_test').status_code==401
  entered={p:threading.Event() for p in n.POLICIES};release=threading.Event();counts={p:0 for p in n.POLICIES}
  def fetch(provider,previous):
   counts[provider]+=1;entered[provider].set();assert release.wait(6)
   if provider=='gdacs':raise httpx.ReadTimeout('private diagnostic')
   return data if provider=='eonet' else {'features':[quake]},{}
  with patch.object(n,'fetch',side_effect=fetch):
   response=client.get('/api/events',headers=headers);assert response.status_code==202
   assert all(e.wait(3) for e in entered.values())
   with ThreadPoolExecutor(max_workers=12) as pool:responses=list(pool.map(lambda _:client.get('/api/events',headers=headers),range(36)))
   assert all(r.status_code==202 for r in responses) and all(c==1 for c in counts.values())
   release.set()
   for f in list(n.pending.values()):
    try:f.result(timeout=10)
    except WeatherDeferred:pass
   response=client.get('/api/events',headers=headers);body=response.json();assert response.status_code==200 and body['state']=='partial' and len(body['events'])==2
   assert body['providers']['gdacs']['failure']=='timeout' and 'private diagnostic' not in response.text
   assert client.get('/api/events/eonet:EONET_test',headers=headers).status_code==200
   assert client.get('/api/events/missing:0',headers=headers).status_code==404
   assert client.get('/api/events/bad!id',headers=headers).status_code==422
   assert all(c==1 for c in counts.values())
  assert n.EventCache(n.stores['gdacs'].root).gate('gdacs')['retry_after_seconds']>=895
  # Only the failed provider recovers. Original successful snapshots and source
  # timestamps survive revalidation, including conditional HTTP304 semantics.
  failed_store=n.stores['gdacs'];recovery_clock=[time.time()+1900];failed_store.clock=lambda:recovery_clock[0]
  snapshots={p:n.stores[p].get('feed') for p in ['eonet','usgs']}
  with patch.object(n,'fetch',return_value=(gdacs,{})) as fetch:
   n.refresh('gdacs');assert fetch.call_count==1 and failed_store.gate('gdacs')['failures']==0
  assert all(n.stores[p].get('feed')==v for p,v in snapshots.items())
  prior=failed_store.get('feed');prior['validated_at']=time.time()-1000;failed_store.put('feed','global',prior);recovery_clock[0]+=1900
  with patch.object(n,'fetch',return_value=(None,{'cache-control':'public, max-age=3600'})) as fetch:
   fresh=n.refresh('gdacs');assert fetch.call_count==1 and fresh['retrieved_at']==prior['retrieved_at'] and fresh['events']==prior['events']
   assert failed_store.gate('gdacs')['retry_after_seconds']>=3600
  assert n.freshness_seconds('eonet',{'headers':{'cache-control':'no-cache, private'},'validated_at':time.time()})==0
  assert n.freshness_seconds('usgs',{'headers':{'cache-control':'public, max-age=60'},'validated_at':time.time()})==60
  print('PASS independent normalized recovery, unitless GDACS placeholders unavailable, preserved304 retrieval times, cache freshness/extended deadline semantics')
  with patch.object(n.database_availability,'ensure',side_effect=DatabaseUnavailable()),patch.object(n,'fetch') as fetch:
   new={p:n.EventCache(Path(tmp)/('outage-'+p)) for p in n.POLICIES}
   with patch.object(n,'stores',new):
    for p in new:
     try:n.refresh(p)
     except DatabaseUnavailable:pass
    assert not fetch.called and all(c.gate(p)['failures']==0 for p,c in new.items())
  # Atomic reservation, process restart, 429 header and independent provider gate.
  store=n.EventCache(Path(tmp)/'gate');clock=[time.time()];store.clock=lambda:clock[0]
  def claim(_):
   try:store.reserve('usgs');return True
   except WeatherDeferred:return False
  with ThreadPoolExecutor(max_workers=12) as pool:assert sum(pool.map(claim,range(48)))==1
  response=httpx.Response(429,headers={'Retry-After':'7200'},request=httpx.Request('GET','https://example.invalid'))
  store.failed('usgs',httpx.HTTPStatusError('hidden',request=response.request,response=response));assert store.gate('usgs')['retry_after_seconds']>=7200
  assert n.EventCache(store.root,clock=lambda:clock[0]).gate('usgs')['retry_after_seconds']>=7200
  store.reserve('eonet');assert store.gate('eonet')['failures']==0
  clock[0]+=7300;store.reserve('usgs');store.succeeded('usgs');assert store.gate('usgs')['failures']==0
  print('PASS protected list/detail,36 concurrent clients/3 independent requests, partial failure/cached details, DB gate,48 atomic reservations/restart/429/recovery; real HTTP0')
  client.close();n.shutdown();database_engine.dispose()

if __name__=='__main__':run()
