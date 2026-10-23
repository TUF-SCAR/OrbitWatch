"""Weather contracts, geometry, cache/quota/failure checks; provider HTTP mocked.

Uses temporary SQLite accounts/cache, never .env or production storage.
"""
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import httpx
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))


def fixture_grib(now):
    from eccodes import codes_grib_new_from_samples,codes_set,codes_set_values,codes_get_message,codes_release
    h=codes_grib_new_from_samples('regular_ll_sfc_grib2')
    try:
        for k,v in {'Ni':360,'Nj':181,'latitudeOfFirstGridPointInDegrees':90,'latitudeOfLastGridPointInDegrees':-90,
                    'longitudeOfFirstGridPointInDegrees':0,'longitudeOfLastGridPointInDegrees':359,
                    'iDirectionIncrementInDegrees':1,'jDirectionIncrementInDegrees':1,'jScansPositively':0,
                    'shortName':'2t','dataDate':int(now.strftime('%Y%m%d')),'dataTime':int(now.strftime('%H%M')),'step':0}.items(): codes_set(h,k,v)
        values=np.array([273.15+(90-y)*.1+np.sin(np.radians(x)) for y in range(181) for x in range(360)])
        codes_set_values(h,values)
        return codes_get_message(h)
    finally: codes_release(h)


def fixture_bundle(now):
    from eccodes import codes_new_from_message,codes_set,codes_set_values,codes_get_message,codes_release
    messages=[]
    for category,param,level_type,level,value in [(0,0,'heightAboveGround',2,280),(6,1,'atmosphere',0,75),(1,7,'surface',0,.001),(2,2,'heightAboveGround',10,5),(2,3,'heightAboveGround',10,-3)]:
        h=codes_new_from_message(fixture_grib(now))
        try:
            for key,v in {'centre':'kwbc','discipline':0,'parameterCategory':category,'parameterNumber':param,'typeOfLevel':level_type,'level':level}.items():codes_set(h,key,v)
            codes_set_values(h,np.full(65160,value));messages.append(codes_get_message(h))
        finally:codes_release(h)
    return b''.join(messages)


def run():
    with tempfile.TemporaryDirectory(dir=ROOT/'.orbitwatch-backups') as tmp,patch('dotenv.load_dotenv',return_value=False),patch.dict(os.environ,{'DATABASE_URL':f'sqlite:///{Path(tmp).as_posix()}/accounts.db','JWT_SECRET_KEY':'weather-isolated-test-secret-with-sufficient-length','ORBITWATCH_INGESTION_ENABLED':'false'}):
        from services.weather_grid import decode_temperature,iso
        from services.weather_cache import WeatherCache,WeatherDeferred
        from services import weather as w
        from core.database import DatabaseBase,database_engine,database_session_maker
        from core.availability import DatabaseUnavailable
        from models.user import User
        from services.auth import hash_password,create_access_token
        from main import app
        from fastapi.testclient import TestClient
        DatabaseBase.metadata.create_all(database_engine)
        now=w.utcnow().replace(minute=0,second=0,microsecond=0)
        grib=fixture_grib(now);field=decode_temperature(grib,'TEST GENERATED GRID',now)
        assert field['grid']['width']==360 and len(field['values_c'])==65160
        assert abs(field['values_c'][0]-9)<.11 and abs(field['values_c'][-1]+9)<.11
        assert abs(field['values_c'][90*360+270]-1)<.11 # Greenwich+90E, equator
        assert abs(field['values_c'][90*360+90]+1)<.11 # 90W
        assert abs(field['values_c'][90*360+180])<.11 # Greenwich
        assert field['kind']=='analysis' and field['missing_count']==0
        for bad in [b'not grib',grib+grib]:
            try: decode_temperature(bad,'bad',now)
            except Exception: pass
            else: raise AssertionError('invalid/multiple GRIB messages accepted')
        print('PASS: GRIB decode, Kelvin conversion, poles/NW ordering, both longitude hemispheres, one-field contract')

        w.cache=WeatherCache(Path(tmp)/'weather');clock=[w.cache.clock()];w.cache.clock=lambda:clock[0]
        c=w.cache
        def claim(_):
            try:c.reserve('noaa');return True
            except WeatherDeferred:return False
        with ThreadPoolExecutor(max_workers=10) as pool: assert sum(pool.map(claim,range(40)))==1
        try:WeatherCache(c.root,clock=lambda:clock[0]).reserve('noaa')
        except WeatherDeferred:pass
        else:raise AssertionError('restart bypassed budget')
        response=httpx.Response(429,headers={'Retry-After':'7200'},request=httpx.Request('GET','https://example.invalid'))
        c.failed('noaa',httpx.HTTPStatusError('test429',request=response.request,response=response))
        assert c.status()['noaa']['next_attempt_at']>=clock[0]+7200
        assert w.coordinates(17.41,78.51)==w.coordinates(17.44,78.54)
        assert w.location_key(0,180)==w.location_key(0,-180)
        assert w.location_key(0,179.99)==w.location_key(0,-179.99)
        print('PASS:40 concurrent/persisted provider reservations,429 Retry-After, rounded coordinate/dateline keys')
        limits=WeatherCache(Path(tmp)/'limits',clock=lambda:clock[0])
        for _ in range(60):limits.reserve('open_meteo');clock[0]+=4
        try:limits.reserve('open_meteo')
        except WeatherDeferred:pass
        else:raise AssertionError('hourly budget was bypassed')
        print('PASS: shared hourly location quota refuses the61st uncached request')

        c.put(field['id'],'global',field)
        field['retrieved_at']=iso(w.utcnow()-timedelta(hours=7))
        assert w.annotate(field,'global')['state']=='stale'
        field['valid_at']=iso(w.utcnow()-timedelta(hours=25))
        assert w.annotate(field,'global') is None
        field['valid_at']=iso(now);field['retrieved_at']=iso(w.utcnow())
        cycle,step,file=w.target()
        fresh={**field,'model_initialized_at':iso(cycle),'valid_at':iso(cycle+timedelta(hours=step)),'source_file':f'{cycle:%Y%m%d}/{file}'}
        c.put(fresh['id'],'global',fresh)
        with patch.object(w,'download',side_effect=AssertionError('cache/status must not download')):
            with ThreadPoolExecutor(max_workers=10) as pool: results=list(pool.map(lambda _:w.global_temperature(),range(30)))
            assert len(results)==30 and all(x['id']==fresh['id'] for x in results)
            assert w.weather_status()['state']=='available'
        point={'latitude':17.5,'longitude':78.5,'current':{'time':int(w.utcnow().timestamp()),'interval':900,**{v:None for v in w.CURRENT_VARIABLES.split(',')},'temperature_2m':26.2,'wind_speed_10m':3.1},'current_units':{'temperature_2m':'°C','wind_speed_10m':'m/s'}}
        with patch.object(w,'download',return_value=json.dumps(point).encode()) as download:
            a=w.location_weather(17.41,78.51);b=w.location_weather(17.42,78.52)
            assert download.call_count==1 and a['values']['temperature_2m']==b['values']['temperature_2m']==26.2
        a['retrieved_at']=iso(w.utcnow()-timedelta(minutes=20));c.put(w.location_key(17.4,78.5),'location',a)
        clock[0]+=4
        with patch.object(w,'download',side_effect=httpx.ReadTimeout('synthetic timeout')):
            stale=w.location_weather(17.4,78.5)
            assert stale['state']=='stale' and stale['provider_unavailable']
        assert c.status()['open_meteo']['failures']==1
        clock[0]+=500
        with patch.object(w,'download',return_value=json.dumps(point).encode()): assert w.location_weather(17.4,78.5)['state']=='available'
        with patch.object(w.database_availability,'ensure',side_effect=DatabaseUnavailable()),patch.object(w,'download') as download:
            try:w.location_weather(-20,170)
            except DatabaseUnavailable:pass
            else:raise AssertionError('DB failure must stop HTTP')
            assert not download.called
        print('PASS: shared global/current caches, stale/hard-expiry, point timeout/backoff/recovery, DB gate prevents HTTP')

        DatabaseBase.metadata.create_all(database_engine)
        with database_session_maker() as session:
            user=User(username='weather_test',email='weather@example.invalid',password_hash=hash_password('isolated-weather-test'))
            session.add(user);session.commit();token=create_access_token(user.id)
        client=TestClient(app);headers={'Authorization':f'Bearer {token}'}
        for path in ['/temperature','/status','/location?latitude=17.4&longitude=78.5']:
            assert client.get('/api/weather'+path).status_code==401
            response=client.get('/api/weather'+path,headers=headers)
            assert response.status_code==200,(path,response.status_code)
            assert response.headers['cache-control']=='private, no-store'
        with patch.object(w.database_availability,'ensure',side_effect=DatabaseUnavailable()),patch.object(w,'download') as download:
            assert client.get('/api/weather/temperature',headers=headers).status_code==503
            assert client.get('/api/weather/location?latitude=0&longitude=0',headers=headers).status_code==503
            assert not download.called
        assert client.get('/api/weather/location?latitude=100&longitude=0',headers=headers).status_code==422
        with patch('routes.weather.global_temperature',side_effect=WeatherDeferred()):
            response=client.get('/api/weather/temperature',headers=headers)
            assert response.status_code==503 and response.headers.get('retry-after')=='30'
        # Real protected cold route returns immediately, even while upstream is
        # blocked. Concurrent clients share one download and then the real grid.
        test_file=f'gfs.t{now:%H}z.pgrb2.1p00.f000'
        entered,release=threading.Event(),threading.Event()
        def slow_download(*args):
            entered.set();assert release.wait(5);return fixture_bundle(now)
        cold=WeatherCache(Path(tmp)/'cold')
        with patch.object(w,'cache',cold),patch.object(w,'target',return_value=(now,0,test_file)),patch.object(w,'download',side_effect=slow_download) as download:
            started=time.monotonic();response=client.get('/api/weather/temperature',headers=headers)
            assert response.status_code==202 and time.monotonic()-started<2
            assert entered.wait(3)
            with ThreadPoolExecutor(max_workers=8) as pool:
                responses=list(pool.map(lambda _:client.get('/api/weather/temperature',headers=headers),range(24)))
            assert all(r.status_code==202 and r.json()['state']=='downloading' for r in responses)
            assert download.call_count==1 and not w.weather_status()['availability']['has_field']
            release.set();w.pending.result(timeout=5)
            response=client.get('/api/weather/temperature',headers=headers)
            assert response.status_code==200 and len(response.json()['values_c'])==65160
            for _ in range(12):assert client.get('/api/weather/temperature',headers=headers).status_code==200
            assert download.call_count==1
            persisted=WeatherCache(cold.root)
            assert persisted.gate('noaa')['next_attempt_at']==cold.gate('noaa')['next_attempt_at']
            cold.clock=lambda:time.time()+1900
            assert w.global_availability(cold.latest_global())['state']=='available'
            cold.clock=time.time;cold.record('noaa','downloading')
            # A crashed old process leaves a phase, but cannot leave the OS
            # lease held. Do not report its abandoned job as still downloading.
            assert w.global_availability(cold.latest_global())['state']=='cooldown'
        # No retry storm during a legitimate persisted cooldown; time advances
        # only in this disposable store, never in normal provider state.
        retry_clock=[time.time()];failure_cache=WeatherCache(Path(tmp)/'failed',clock=lambda:retry_clock[0])
        with patch.object(w,'cache',failure_cache),patch.object(w,'target',return_value=(now,0,test_file)),patch.object(w,'download',side_effect=httpx.ReadTimeout('private raw diagnostic must not escape')) as download:
            client.get('/api/weather/temperature',headers=headers)
            try:w.pending.result(timeout=5)
            except WeatherDeferred:pass
            response=client.get('/api/weather/temperature',headers=headers)
            assert response.status_code==503 and response.json()['state']=='cooldown'
            assert int(response.headers['retry-after'])>=1800
            assert response.json()['last_failure']['category']=='timeout'
            assert 'private raw' not in response.text
            for _ in range(24):assert client.get('/api/weather/temperature',headers=headers).status_code==503
            assert download.call_count==1
            restarted=WeatherCache(failure_cache.root,clock=lambda:retry_clock[0])
            assert restarted.gate('noaa')['retry_after_seconds']>=1800
            assert restarted.event('noaa')['category']=='timeout'
            retry_clock[0]+=1900
            download.side_effect=None;download.return_value=fixture_bundle(now)
            client.get('/api/weather/temperature',headers=headers);w.pending.result(timeout=5)
            assert client.get('/api/weather/temperature',headers=headers).status_code==200
            assert download.call_count==2 and failure_cache.gate('noaa')['failures']==0
        # An absent local decoder must not spend a NOAA reservation or be
        # incorrectly presented as an upstream HTTP/network failure.
        missing=WeatherCache(Path(tmp)/'missing-decoder')
        with patch.object(w,'cache',missing),patch.dict(sys.modules,{'eccodes':None}),patch.object(w,'download') as download:
            client.get('/api/weather/temperature',headers=headers)
            try:w.pending.result(timeout=5)
            except WeatherDeferred:pass
            response=client.get('/api/weather/temperature',headers=headers)
            assert response.json()['last_failure']['category']=='decoder_unavailable'
            assert missing.gate('noaa')['failures']==0 and not download.called
        print('PASS: nonblocking cold202-to-200,24 concurrent clients/one download; persisted503/Retry-After/no retry storm, timed recovery, missing decoder spends0 HTTP')
        client.close();database_engine.dispose();w.executor.shutdown(wait=True)
        print('PASS: protected global/status/location routes, safe503 and coordinate validation; real provider HTTP0')


if __name__=='__main__':run()
