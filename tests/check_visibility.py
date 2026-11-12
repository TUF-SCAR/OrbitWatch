"""Fixed scientific fixtures + actual authenticated API, isolated SQLite only."""
import os
from pathlib import Path
import sys
import tempfile
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))


def run(serve=False):
    with tempfile.TemporaryDirectory(prefix='orbitwatch-visibility-') as directory, patch('dotenv.load_dotenv',return_value=False), patch.dict(os.environ,{
        'DATABASE_URL':f'sqlite:///{Path(directory).as_posix()}/test.db','JWT_SECRET_KEY':'isolated-visibility-fixture-key-do-not-use-outside-tests',
        'ORBITWATCH_INGESTION_ENABLED':'false','ORBITWATCH_WEATHER_PROVIDER_REQUESTS':'false','CORS_ALLOWED_ORIGINS':'http://127.0.0.1:5174'}):
        from services.visibility import TS,ephemeris,satellite_windows,celestial_windows,prediction,local,CACHE,instant_geometry
        from services.visibility_forecast import match_forecast,forecast
        from services.account_targets import CELESTIAL
        from skyfield.api import wgs84
        from core.database import DatabaseBase,database_engine,database_session_maker
        from models.user import User
        from models.account import ObservationLocation,NotificationPreferences
        from models.alerts import AlertSubscription,InboxNotification
        from models.satellite_orbital_data import SatelliteOrbitalData,SatelliteOrbitalDataHistory
        from main import app
        from fastapi.testclient import TestClient
        from sqlalchemy import select
        eph=ephemeris(); assert eph is not None,'Install pinned skyfield-data==7.0.0'
        start=datetime(2024,5,9,tzinfo=timezone.utc)
        loc={'latitude':40.7128,'longitude':-74.006,'timezone':'America/New_York'}
        rec=SimpleNamespace(epoch=start+timedelta(hours=12),norad_id=25544,object_name='Fixed ISS fixture',source='isolated fixed scientific fixture',
            tle_line1='1 25544U 98067A   24130.50000000  .00016717  00000+0  30168-3 0  9994',
            tle_line2='2 25544  51.6400 160.0000 0005000  90.0000 270.0000 15.50000000450000')
        result=satellite_windows(rec,loc,start,24,eph)
        assert len(result['windows'])==6
        first=result['windows'][0]
        assert abs((datetime.fromisoformat(first['start_utc'])-datetime(2024,5,9,2,53,9,tzinfo=timezone.utc)).total_seconds())<2
        assert abs(first['max_elevation_degrees']-46.68)<.05
        assert first['sunlit_at_maximum'] is False and first['sun_altitude_degrees']<-20
        assert 'unverified' in result['brightness'].lower()
        assert any(w['sun_altitude_degrees']>-6 for w in result['windows'])
        assert any(w['sunlit_at_maximum'] for w in result['windows'])
        # Independently sample the same pass at one-second spacing; verify maximum.
        from skyfield.api import EarthSatellite
        sat=EarthSatellite(rec.tle_line1,rec.tle_line2,rec.object_name,TS)
        dates=[datetime.fromisoformat(first['start_utc'])+timedelta(seconds=i) for i in range(first['duration_seconds'])]
        alt=(sat-wgs84.latlon(loc['latitude'],loc['longitude'])).at(TS.from_datetimes(dates)).altaz()[0].degrees
        assert abs(float(np.max(alt))-first['max_elevation_degrees'])<.02
        overhead=wgs84.subpoint(sat.at(TS.from_datetime(start+timedelta(days=1))))
        midnight=satellite_windows(rec,{'latitude':overhead.latitude.degrees,'longitude':overhead.longitude.degrees,'timezone':'UTC'},start+timedelta(hours=23,minutes=40),1,eph)
        assert any(w['start_utc'][:10]!=w['end_utc'][:10] for w in midnight['windows'])
        assert satellite_windows(rec,loc,start+timedelta(days=9),24,eph)['state']=='unavailable'
        bad=SimpleNamespace(**{**vars(rec),'epoch':start})
        try: satellite_windows(bad,loc,start,24,eph); raise AssertionError('epoch mismatch accepted')
        except ValueError: pass
        clipped=satellite_windows(rec,loc,datetime.fromisoformat(first['maximum_at_utc']),1,eph)
        assert clipped['windows'][0]['window_clipped']
        no_light=satellite_windows(rec,loc,start,24,None)
        assert not no_light['windows'][0]['conditions_available'] and no_light['windows'][0]['sunlit_at_maximum'] is None
        assert len(CELESTIAL)==8
        for target in CELESTIAL:
            r=celestial_windows(target,loc,start,24,eph)
            assert r['state']=='available' and -90<=r['altitude_now_degrees']<=90
            for w in r['windows']:
                assert w['max_elevation_degrees']>=10 and w['start_utc']<w['end_utc']
            if target=='moon': assert 0<=r['moon_illumination_percent']<=100
            if target=='moon':
                window=next(w for w in r['windows'] if datetime.fromisoformat(w['start_utc'])>start)
                beginning=datetime.fromisoformat(window['start_utc'])
                inside=instant_geometry('celestial','moon',None,loc,beginning)
                before=instant_geometry('celestial','moon',None,loc,beginning-timedelta(seconds=2))
                assert inside['altitude_degrees']>=10 and inside['sun_altitude_degrees']<=0
                assert before['altitude_degrees']<10 or before['sun_altitude_degrees']>0
            if target=='neptune': assert 'Telescope' in r['equipment']
        polar=celestial_windows('jupiter',{**loc,'latitude':89},start,24,eph)
        assert polar['state']=='available' and len(polar['rise_set'])<=2
        assert celestial_windows('moon',loc,start,24,None)['state']=='unavailable'
        assert local(datetime(2024,3,10,6,30,tzinfo=timezone.utc),loc).endswith('-05:00')
        assert local(datetime(2024,3,10,7,30,tzinfo=timezone.utc),loc).endswith('-04:00')
        now=datetime.now(timezone.utc)
        dataset={'retrieved_epoch':now.timestamp(),'retrieved_at':now.isoformat(),'provider':'fixture','attribution':'isolated forecast fixture',
                 'rows':[{'valid_epoch':now.timestamp()+3600,'cloud_cover_percent':20,'precipitation_probability_percent':5,'precipitation_mm':0}]}
        assert match_forecast(dataset,now+timedelta(hours=1),now)['state']=='available'
        assert match_forecast(dataset,now+timedelta(hours=2),now)['state']=='unavailable'
        assert match_forecast(dataset,now+timedelta(hours=1),now+timedelta(hours=2))['state']=='unavailable'
        missing=prediction('satellite','25544',None,loc,start,24,None);assert missing['state']=='unavailable'
        assert forecast(40,-74) is None  # Providers explicitly disabled; no current-weather substitution.
        DatabaseBase.metadata.create_all(database_engine)
        client=TestClient(app,raise_server_exceptions=False)
        auth={}; location_ids={}; checks=0
        for n in (1,2):
            r=client.post('/api/auth/register',json={'username':f'visibility_fixture{n}','email':f'visibility{n}@example.invalid','password':'Disposable-visibility-2026'})
            assert r.status_code==201,r.text
            auth[n]={'Authorization':'Bearer '+r.json()['access_token']}
            r=client.post('/api/account/locations',headers=auth[n],json={'name':f'Isolated New York fixture {n}','latitude':40.7128,'longitude':-74.006,'timezone':'America/New_York','is_default':True})
            assert r.status_code==201,r.text
            location_ids[n]=r.json()['id']
            for kind,target in [('celestial','moon'),('satellite','20580')]:
                assert client.post('/api/account/alert-subscriptions',headers=auth[n],json={'kind':kind,'target_id':target}).status_code==201
        second=client.post('/api/account/locations',headers=auth[1],json={'name':'Isolated London fixture','latitude':51.5074,'longitude':-0.1278,'timezone':'Europe/London','is_default':False})
        assert second.status_code==201
        path='/api/account/visibility/'
        for endpoint in ('satellites','celestial'):
            assert client.get(path+endpoint).status_code==401;checks+=1
            for query,status in [(f'?location_id={location_ids[2]}',404),('?hours=49',422),('?hours=0',422),('?target_id=sun',422),('?location_id=bad',422)]:
                assert client.get(path+endpoint+query,headers=auth[1]).status_code==status;checks+=1
            r=client.get(path+endpoint,headers=auth[1]); assert r.status_code==200,r.text;checks+=1
            assert r.json()['location']['id']==location_ids[1] and len(r.json()['items'])==1
            assert r.headers['cache-control']=='no-store'
        switched=client.get(path+'celestial?location_id='+second.json()['id'],headers=auth[1]);assert switched.status_code==200 and switched.json()['location']['timezone']=='Europe/London'
        assert client.get(path+'celestial?target_id=mars',headers=auth[1]).status_code==404;checks+=1
        sat_response=client.get(path+'satellites',headers=auth[1]).json()
        assert sat_response['items'][0]['state']=='unavailable' and 'missing' in sat_response['items'][0]['reason']
        assert client.get('/api/account/notifications',headers=auth[1]).json()['items']==[]
        # Every target in a batch shares one forecast dataset retrieval.
        with patch('routes.visibility.forecast',return_value=None) as fetch:
            client.get(path+'celestial',headers=auth[1]); assert fetch.call_count==1
        print(f'PASS: fixed scientific geometry, illumination, twilight, epoch rejection, clipping, eight celestial targets, polar, DST, forecast validity; {checks} authenticated HTTP checks')
        if serve:
            import uvicorn
            print('Isolated browser fixture: visibility_fixture1 / Disposable-visibility-2026; no production writes',flush=True)
            # Block existing globe/weather ingestion calls for this account-only smoke.
            async def isolated(scope,receive,send):
                if scope['type']=='http' and (scope['path'].startswith('/api/weather') or scope['path'].startswith('/api/events')):
                    from starlette.responses import JSONResponse
                    return await JSONResponse({'detail':'External providers disabled in isolated browser fixture'},status_code=503)(scope,receive,send)
                return await app(scope,receive,send)
            uvicorn.run(isolated,host='127.0.0.1',port=8001,log_level='warning')
        client.close()
        database_engine.dispose()


if __name__=='__main__':run('--serve' in sys.argv)
