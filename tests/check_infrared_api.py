"""Isolated authenticated IR routes; mocked WMS, temporary cache, no .env."""
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import httpx

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))


def jpeg(width,height):
    return b'\xff\xd8\xff\xc0\x00\x0b\x08'+height.to_bytes(2,'big')+width.to_bytes(2,'big')+b'\x01\x01\x11\x00\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00\x01\xff\xd9'


with TemporaryDirectory() as directory, patch('dotenv.load_dotenv',return_value=False), patch.dict(os.environ,{
    'DATABASE_URL':f'sqlite:///{Path(directory).as_posix()}/auth.db',
    'JWT_SECRET_KEY':'isolated-infrared-api-test',
    'ORBITWATCH_INFRARED_ENABLED':'true','ORBITWATCH_INFRARED_LICENSE_CONFIRMED':'true',
    'ORBITWATCH_WEATHER_PROVIDER_REQUESTS':'true'}):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from services.infrared import InfraredService,iso,LAYER
    from routes import weather
    from core.security import get_current_user
    now=[1794643200.0];calls=[]
    def handler(request):
        calls.append(request)
        if request.url.params['request']=='GetCapabilities':
            xml=f'<WMS_Capabilities><Layer><Name>{LAYER}</Name><Dimension name="time">{iso(now[0])}</Dimension></Layer></WMS_Capabilities>'
            return httpx.Response(200,headers={'Content-Type':'text/xml'},text=xml)
        return httpx.Response(200,headers={'Content-Type':'image/jpeg'},content=jpeg(int(request.url.params['width']),int(request.url.params['height'])))
    service=InfraredService(Path(directory)/'ir',lambda:now[0],lambda **kw:httpx.Client(transport=httpx.MockTransport(handler),**kw))
    app=FastAPI();app.include_router(weather.router)
    checks=0
    with patch.object(weather,'infrared',service),TestClient(app) as client:
        assert client.get('/api/weather/infrared/current').status_code==401;checks+=1
        app.dependency_overrides[get_current_user]=lambda:object()
        metadata=client.get('/api/weather/infrared/current');assert metadata.status_code==200;checks+=1
        m=metadata.json();assert m['layer']==LAYER and m['image_cached'] is False and m['retrieved_at'] is None;checks+=1
        assert m['observation_time']==iso(now[0]) and m['license_url'].endswith('/by/4.0/') and m['source_kind']=='infrared_observation';checks+=1
        for _ in range(10):assert client.get('/api/weather/infrared/current').json()['version']==m['version']
        assert len(calls)==1;checks+=1
        image=client.get(m['image_url']);assert image.status_code==503 and int(image.headers['Retry-After'])>=30;checks+=1
        now[0]+=61
        image=client.get(m['image_url']);assert image.status_code==200 and image.headers['content-type']=='image/jpeg';checks+=1
        assert image.headers['etag']==m['etag'] and image.headers['X-Observation-Time']==m['observation_time'];checks+=1
        assert 'X-Retrieved-At' in image.headers['Access-Control-Expose-Headers'];checks+=1
        assert len(calls)==2;checks+=1
        assert client.get(m['image_url'],headers={'If-None-Match':m['etag']}).status_code==304;checks+=1
        assert len(calls)==2;checks+=1
        ready=client.get('/api/weather/infrared/current').json();assert ready['image_cached'] and ready['retrieved_at']==iso(now[0]);checks+=1
        for query in ['width=8192','width=1024&bbox=-181,0,20,20','width=1024&bbox=0,0,20,20&height=999']:
            route='/api/weather/infrared/current?' if query=='width=8192' else f'/api/weather/infrared/frame?time={m["observation_time"]}&'
            assert client.get(route+query).status_code==422;checks+=1
        now[0]+=61
        regional=client.get(f'/api/weather/infrared/frame?time={m["observation_time"]}&width=1024&bbox=0,0,20,10&height=512')
        assert regional.status_code==200 and calls[-1].url.params['bbox']=='0,0,20,10';checks+=1
        # Hard-expired observations never remain publicly reusable, even with ETag.
        now[0]+=43201
        assert client.get(m['image_url'],headers={'If-None-Match':m['etag']}).status_code==422;checks+=1
        with patch.dict(os.environ,{'ORBITWATCH_INFRARED_ENABLED':'false'}):
            assert client.get('/api/weather/infrared/current').json()['state']=='disabled';checks+=1
    print(f'PASS: {checks} authenticated API/cache/version/ETag/region/expiry/licence checks; isolated mocked WMS only')
