"""No provider or production access: cold readers, pair publication and recovery."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from io import BytesIO
import sys,time,json
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'backend'))
from PIL import Image
from services.infrared import InfraredService,iso,LAYER
from services.weather_cache import WeatherDeferred
clock=[1794355200.];calls=[];bad=[False]
def source(params,*_):
 calls.append(params['request'])
 if params['request']=='GetCapabilities':
  return f'<WMS_Capabilities><Layer><Name>{LAYER}</Name><Dimension name="time">{iso(int(clock[0]//10800)*10800)}</Dimension></Layer></WMS_Capabilities>'.encode()
 if bad[0]:return b'bad replacement'
 buffer=BytesIO();Image.new('RGB',(2048,1024),(160,160,160)).save(buffer,'JPEG');return buffer.getvalue()
with TemporaryDirectory() as temp,patch.dict('os.environ',{'ORBITWATCH_INFRARED_ENABLED':'true','ORBITWATCH_INFRARED_LICENSE_CONFIRMED':'true','ORBITWATCH_WEATHER_PROVIDER_REQUESTS':'true'}):
 service=InfraredService(temp,lambda:clock[0]);service.retrieve=source
 for read in (service.current,lambda:service.frame(iso(clock[0]))):
  try:read()
  except WeatherDeferred:pass
  else:raise AssertionError('Empty cache must be unavailable')
 assert calls==[]
 try:service.refresh_pair()
 except WeatherDeferred:pass # capabilities/map share one minute budget
 clock[0]+=301;service.refresh_pair()
 assert calls==['GetCapabilities','GetMap']
 timings={}
 for width in (1024,2048):
  start=time.perf_counter();meta=service.current(width);timings[f'metadata_{width}_ms']=(time.perf_counter()-start)*1000
  start=time.perf_counter();data,info=service.frame(meta['observation_time'],width);timings[f'cache_read_{width}_ms']=(time.perf_counter()-start)*1000
  with Image.open(BytesIO(data)) as image:
   assert image.size==(width,width//2) and image.mode=='RGBA'
 old=service.current()['version'];old_time=service.current()['observation_time']
 restarted=InfraredService(temp,lambda:clock[0]);restarted.retrieve=lambda *_:(_ for _ in ()).throw(AssertionError('Reader fetched upstream'))
 assert restarted.current()['version']==old and restarted.frame(old_time)[0]
 clock[0]+=10800;bad[0]=True
 for _ in range(2):
  try:service.refresh_pair()
  except WeatherDeferred:pass
  clock[0]+=301
 assert service.current()['version']==old
 bad[0]=False;service.refresh_pair()
 assert service.current()['version']!=old
 # Old immutable URLs remain valid after publication and survive restart.
 assert restarted.frame(old_time)[0]
 clock[0]+=43201
 try:restarted.current()
 except WeatherDeferred:pass
 else:raise AssertionError('Expired cache accepted')
print(json.dumps({'result':'pass','cases':['empty readers no upstream','warm simultaneous resolutions','restart','bad replacement retention','automatic recovery','old URL retention','expiry'],'timings':timings},indent=2))
