"""Authenticated cache-only routes, one isolated source and no production .env."""
import sys,os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from io import BytesIO
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'backend'))
with TemporaryDirectory() as directory,patch('dotenv.load_dotenv',return_value=False),patch.dict(os.environ,{
 'DATABASE_URL':f'sqlite:///{Path(directory).as_posix()}/test.db','JWT_SECRET_KEY':'isolated-ir',
 'ORBITWATCH_INFRARED_ENABLED':'true','ORBITWATCH_INFRARED_LICENSE_CONFIRMED':'true','ORBITWATCH_WEATHER_PROVIDER_REQUESTS':'true'}):
 from fastapi import FastAPI
 from fastapi.testclient import TestClient
 from routes import weather
 from core.security import get_current_user
 from services.infrared import InfraredService,iso,LAYER
 from services.weather_cache import WeatherDeferred
 from PIL import Image
 now=[1794355200.];calls=[]
 service=InfraredService(directory,lambda:now[0])
 def retrieve(params,*_):
  calls.append(params['request'])
  if params['request']=='GetCapabilities':return f'<WMS_Capabilities><Layer><Name>{LAYER}</Name><Dimension name="time">{iso(1794355200.)}</Dimension></Layer></WMS_Capabilities>'.encode()
  out=BytesIO();Image.new('RGB',(2048,1024),(180,180,180)).save(out,'JPEG');return out.getvalue()
 service.retrieve=retrieve
 app=FastAPI();app.include_router(weather.router)
 with patch.object(weather,'infrared',service),TestClient(app) as client:
  assert client.get('/api/weather/infrared/current').status_code==401
  app.dependency_overrides[get_current_user]=lambda:object()
  assert client.get('/api/weather/infrared/current').status_code==503 and not calls
  try:service.refresh_pair()
  except WeatherDeferred:pass
  now[0]+=301;service.refresh_pair();assert len(calls)==2
  for width in (1024,2048):
   meta=client.get(f'/api/weather/infrared/current?width={width}').json()
   assert meta['image_cached'] and meta['width']==width
   response=client.get(meta['image_url']);assert response.status_code==200 and response.headers['Content-Type']=='image/png'
   assert client.get(meta['image_url'],headers={'If-None-Match':response.headers['ETag']}).status_code==304
  assert len(calls)==2
  assert client.get('/api/weather/infrared/current?width=8192').status_code==422
  assert client.get(meta['image_url']+'&bbox=0,0,20,10&height=1024').status_code==503
  now[0]+=43201
  assert client.get('/api/weather/infrared/current').status_code==503
  assert client.get(meta['image_url']).status_code==503
print('PASS cache-only authenticated API, pair dimensions, PNG media, immutable ETag, no reader acquisition, unavailable/expiry')
