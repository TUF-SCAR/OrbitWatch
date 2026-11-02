"""Disposable real auth/storage/worker tests. Never loads production .env."""
from contextlib import ExitStack
import base64
from datetime import datetime,timedelta,timezone,time as daytime
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'backend'))


def b64(value):return base64.urlsafe_b64encode(value).decode().rstrip('=')


def run(postgres=False,serve=False):
    private=ec.generate_private_key(ec.SECP256R1());public=private.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
    config={'ORBITWATCH_VAPID_PRIVATE_KEY':b64(private.private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())),
        'ORBITWATCH_VAPID_PUBLIC_KEY':b64(public),'ORBITWATCH_VAPID_SUBJECT':'mailto:isolated@example.invalid','ORBITWATCH_PUSH_ENCRYPTION_KEY':Fernet.generate_key().decode()}
    with tempfile.TemporaryDirectory(prefix='orbitwatch-delivery-') as directory,ExitStack() as cleanup,patch('dotenv.load_dotenv',return_value=False):
        url=f'sqlite:///{Path(directory).as_posix()}/delivery.db'
        if postgres:
            import psycopg
            with psycopg.connect(host='127.0.0.1',port=55444,user='orbitwatch_test',dbname='postgres',autocommit=True) as db:
                db.execute('DROP DATABASE IF EXISTS orbitwatch_delivery_test WITH (FORCE)');db.execute('CREATE DATABASE orbitwatch_delivery_test')
            url='postgresql+psycopg://orbitwatch_test@127.0.0.1:55444/orbitwatch_delivery_test'
        with patch.dict(os.environ,{**config,'DATABASE_URL':url,'JWT_SECRET_KEY':'isolated-notification-test-key-no-production-use',
                'ORBITWATCH_INGESTION_ENABLED':'false','ORBITWATCH_NOTIFICATION_PROVIDER_REQUESTS':'false','ORBITWATCH_WEATHER_PROVIDER_REQUESTS':'false',
                'ORBITWATCH_EVENT_PROVIDER_REQUESTS':'false','CORS_ALLOWED_ORIGINS':'http://127.0.0.1:5174'}):
            from sqlalchemy import select,delete,func,text,update,event as sql_event
            from sqlalchemy.orm import Session
            from core.database import DatabaseBase,database_engine as engine
            cleanup.callback(engine.dispose)
            from models.user import User
            from models.account import ObservationLocation,NotificationPreferences
            from models.alerts import AlertSubscription,InboxNotification
            from models.satellite_orbital_data import SatelliteOrbitalData,SatelliteOrbitalDataHistory
            from models.notification_delivery import PushDevice,NotificationRun,NotificationDelivery
            from services.notification_policy import quiet,distance,event_candidate,astronomy_candidate
            from services.notification_runner import lease,persist,process_outbox,run_once
            from services.browser_push import validate_subscription,configuration,encrypt_subscription
            from main import app
            from fastapi.testclient import TestClient
            if not postgres:
                @sql_event.listens_for(engine,'connect')
                def foreign_keys(connection,record):connection.execute('PRAGMA foreign_keys=ON')
            DatabaseBase.metadata.create_all(engine,tables=[User.__table__,SatelliteOrbitalData.__table__,SatelliteOrbitalDataHistory.__table__])
            if postgres:
                migrations=sorted((ROOT/'backend/migrations').glob('00[2345]_*.sql'))
                with psycopg.connect(host='127.0.0.1',port=55444,user='orbitwatch_test',dbname='orbitwatch_delivery_test',autocommit=True) as db:
                    for file in migrations:db.execute(file.read_text(),prepare=False);db.execute(file.read_text(),prepare=False)
            else:
                for model in (ObservationLocation,NotificationPreferences,AlertSubscription,InboxNotification,PushDevice,NotificationRun,NotificationDelivery):model.__table__.create(engine)
            client=TestClient(app,raise_server_exceptions=False);cleanup.callback(client.close);auth={};users={};locations={};subscriptions={};checks=0
            def request(method,path,expected=200,who=1,**kwargs):
                nonlocal checks
                r=client.request(method,path,headers=auth.get(who,{}),**kwargs);assert r.status_code==expected,(path,r.status_code,r.text[:200]);checks+=1;return r
            for n in (1,2):
                r=client.post('/api/auth/register',json={'username':f'delivery_fixture{n}','email':f'delivery{n}@example.invalid','password':'Disposable-delivery-2026'});assert r.status_code==201
                auth[n]={'Authorization':'Bearer '+r.json()['access_token']};users[n]=request('GET','/api/auth/me',who=n).json()['id']
                locations[n]=request('POST','/api/account/locations',201,who=n,json={'name':f'ISOLATED TEST observation point {n}','latitude':40.7128,'longitude':-74.006,'timezone':'America/New_York','is_default':True}).json()['id']
                subscriptions[n]=request('POST','/api/account/alert-subscriptions',201,who=n,json={'kind':'celestial','target_id':'moon'}).json()['id']
            request('GET','/api/account/notification-delivery',401,who=0)
            assert request('GET','/api/account/notification-delivery').json()['scheduler_state']=='not_operational'
            subscription={'endpoint':'https://fcm.googleapis.com/fcm/send/ISOLATED-NEVER-SEND','keys':{'auth':b64(b'0123456789abcdef'),'p256dh':b64(public)}}
            assert configuration()
            request('POST','/api/account/push-subscriptions',422,json={**subscription,'consent':False})
            for endpoint in ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://example.invalid/a','https://fcm.googleapis.com.evil.invalid/a','https://fcm.googleapis.com:444/a','https://user@fcm.googleapis.com/a']:
                request('POST','/api/account/push-subscriptions',422,json={**subscription,'endpoint':endpoint,'consent':True})
            device=request('POST','/api/account/push-subscriptions',201,json={**subscription,'consent':True}).json()['id']
            assert request('POST','/api/account/push-subscriptions',json={**subscription,'consent':True}).json()['id']==device
            request('POST','/api/account/push-subscriptions',409,who=2,json={**subscription,'consent':True})
            request('DELETE','/api/account/push-subscriptions/'+device,204,who=2)
            assert len(request('GET','/api/account/notification-delivery').json()['devices'])==1
            assert request('GET','/api/account/notification-delivery',who=2).json()['devices']==[]
            with Session(engine) as db:
                row=db.get(PushDevice,device);assert subscription['endpoint'] not in row.encrypted_subscription
            now=datetime.now(timezone.utc)
            pref=SimpleNamespace(notifications_enabled=True,celestial_alerts=True,satellite_alerts=True,natural_event_alerts=True,advance_warning_minutes=30,
                quiet_hours_enabled=True,quiet_timezone_mode='explicit',quiet_timezone='America/New_York',quiet_start=daytime(22),quiet_end=daytime(7))
            assert quiet(pref,[],datetime(2024,3,10,6,30,tzinfo=timezone.utc))
            assert quiet(pref,[],datetime(2024,3,10,7,30,tzinfo=timezone.utc))
            assert not quiet(pref,[],datetime(2024,3,10,16,tzinfo=timezone.utc))
            pref.quiet_timezone_mode='default_location';assert quiet(pref,[],now)
            pref.quiet_hours_enabled=False
            loc=SimpleNamespace(id=locations[1],name='ISOLATED TEST location',latitude=40.7128,longitude=-74.006,timezone='America/New_York')
            assert distance(0,179.9,0,-179.9)<23
            for warning in (10,30,60):
                pref.advance_warning_minutes=warning;moment=now+timedelta(minutes=warning)
                result={'state':'available','computed_at':now.isoformat(),'equipment':'Visibility depends on conditions.',
                    'windows':[{'start_utc':moment.isoformat(),'end_utc':(moment+timedelta(hours=2)).isoformat(),'max_elevation_degrees':45,'window_clipped':False}]}
                assert astronomy_candidate('celestial','moon','Moon',result,loc,pref,now)
                assert astronomy_candidate('celestial','moon','Moon',result,loc,pref,now+timedelta(minutes=warning+1)) is None
                assert astronomy_candidate('satellite','20580','Hubble',result,loc,pref,now) is None
            event={'id':'usgs:isolated1','provider':'usgs','category':'earthquake','status':'reviewed','reported_at':(now-timedelta(minutes=20)).isoformat(),
                'retrieved_at':now.isoformat(),'updated_at':now.isoformat(),'data_state':'available','geometry':{'type':'Point','coordinates':[-74,40.7]},
                'position':[-74,40.7],'measurements':[{'label':'Magnitude (mw)','value':4.5}],'source_url':'https://earthquake.usgs.gov/earthquakes/eventpage/isolated1'}
            assert event_candidate(event,loc,120,now)
            assert not event_candidate(event,SimpleNamespace(**{**vars(loc),'latitude':0,'longitude':0}),120,now)
            assert not event_candidate({**event,'reported_at':(now-timedelta(days=3)).isoformat()},loc,120,now)
            assert event_candidate({**event,'geometry':{'type':'Polygon','coordinates':[[[-74,40.7],[-74,40.8],[-74.1,40.8],[-74,40.7]]]}},loc,120,now)
            assert not event_candidate(event,loc,120,now,4.5)
            assert event_candidate({**event,'measurements':[{'label':'Magnitude','value':5.1}]},loc,120,now,4.5)
            assert not event_candidate({**event,'provider':'eonet','status':'open','closed_at':None,'reported_at':(now-timedelta(days=2)).isoformat()},loc,120,now)
            assert not event_candidate({**event,'provider':'gdacs','status':'Green'},loc,120,now)
            assert event_candidate({**event,'provider':'gdacs','status':'Red'},loc,120,now,2)
            candidate={'kind':'celestial','target_id':'moon','category':'celestial','title':'ISOLATED TEST — real pipeline fixture','message':'Disposable fixed candidate; never production.',
                'opportunity_at':now+timedelta(minutes=30),'expires_at':now+timedelta(hours=1),'source_at':now,'key':'isolated:opportunity:1','severity':None,'source_url':None}
            # Exercise real Web Push encryption/VAPID with the network boundary mocked.
            from services.browser_push import send_push
            import requests
            accepted_response=requests.Response();accepted_response.status_code=201
            with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443))]),patch('requests.Session.request',return_value=accepted_response) as network:
                assert send_push(SimpleNamespace(encrypted_subscription=encrypt_subscription(subscription)),{'title':'isolated encryption fixture'},60)==201
                arguments=network.call_args.kwargs
                assert arguments['allow_redirects'] is False and arguments['timeout']==5
                assert any(key.lower()=='authorization' for key in arguments['headers'])
                assert b'isolated encryption fixture' not in arguments['data']
            # Disabled preference creates nothing; explicit opt-in then persists.
            with lease(engine) as token:
                assert token and not persist(engine,token,users[1],subscriptions[1],locations[1],candidate,now)
                with Session(engine) as db:
                    db.add(NotificationPreferences(owner_id=users[1],notifications_enabled=True,celestial_alerts=True));db.commit()
                assert persist(engine,token,users[1],subscriptions[1],locations[1],candidate,now)
                assert not persist(engine,token,users[1],subscriptions[1],locations[1],candidate,now)
                with lease(engine) as overlap:assert overlap is None
                with Session(engine) as db:
                    ledger=db.scalar(select(NotificationDelivery));inbox_id=ledger.inbox_id
                request('DELETE','/api/account/notifications/'+inbox_id)
                assert not persist(engine,token,users[1],subscriptions[1],locations[1],candidate,now)
                with Session(engine) as db:
                    db.execute(delete(InboxNotification).where(InboxNotification.id==inbox_id));db.commit()
                assert not persist(engine,token,users[1],subscriptions[1],locations[1],candidate,now)
                assert not persist(engine,token,users[1],subscriptions[2],locations[2],{**candidate,'key':'wrong-owner'},now)
            # A separate opportunity queues only after atomic inbox commit.
            candidate2={**candidate,'key':'isolated:opportunity:2','opportunity_at':now+timedelta(hours=3)}
            with lease(engine) as token:
                assert persist(engine,token,users[1],subscriptions[1],locations[1],candidate2,now)
                calls=[]
                def accepted(device,payload,ttl):
                    with Session(engine) as db:assert db.scalar(select(NotificationDelivery).where(NotificationDelivery.state=='sending')).inbox_id
                    assert 'latitude' not in json.dumps(payload) and 'ISOLATED TEST location' not in json.dumps(payload)
                    calls.append(payload);return 201
                process_outbox(engine,token,time.monotonic()+10,accepted)
                process_outbox(engine,token,time.monotonic()+10,accepted)
                assert len(calls)==1
                with Session(engine) as db:
                    ledger=db.scalar(select(NotificationDelivery).where(NotificationDelivery.dedup_key!=__import__('hashlib').sha256(candidate['key'].encode()).hexdigest()))
                    assert ledger.state=='push_accepted'
                # Simulate crash after persisted send intent. Never blindly resend.
                with Session(engine) as db:
                    ledger.state='sending';ledger.devices=[{'id':device,'state':'sending','attempts':1}];db.merge(ledger);db.commit()
                process_outbox(engine,token,time.monotonic()+10,accepted);assert len(calls)==1
                with Session(engine) as db:assert db.get(NotificationDelivery,ledger.id).state=='push_unknown'
            # Explicit temporary provider rejection retries; permanent expiry revokes.
            retry_candidate={**candidate,'key':'isolated:retry','opportunity_at':now+timedelta(hours=6),'expires_at':now+timedelta(hours=8)}
            class Rejection(Exception):
                def __init__(self,code):
                    self.response=requests.Response();self.response.status_code=code;self.response.headers['Retry-After']='600';self.status_code=code
            def reject(*_):raise Rejection(429)
            with lease(engine) as token:
                assert persist(engine,token,users[1],subscriptions[1],locations[1],retry_candidate,now)
                process_outbox(engine,token,time.monotonic()+10,reject)
                with Session(engine) as db:
                    retry_row=db.scalar(select(NotificationDelivery).where(NotificationDelivery.state=='push_retry'))
                    assert retry_row and retry_row.devices[0]['attempts']==1
                    assert retry_row.devices[0]['next_at']>=now.timestamp()+590
                    retry_row.next_attempt_at=now-timedelta(seconds=1);retry_row.devices=[{**retry_row.devices[0],'next_at':now.timestamp()-1}];db.commit()
                def gone(*_):raise Rejection(410)
                process_outbox(engine,token,time.monotonic()+10,gone)
                with Session(engine) as db:assert db.get(PushDevice,device) is None
            # Actual DE421 opportunity -> trusted runner -> inbox, at a fixed date.
            from services.visibility import celestial_windows,ephemeris
            base=datetime(2024,5,9,12,tzinfo=timezone.utc)
            genuine=celestial_windows('moon',{'latitude':40.7128,'longitude':-74.006,'timezone':'America/New_York'},base,48,ephemeris())
            useful=next(window for window in genuine['windows'] if not window['window_clipped'])
            fixed=datetime.fromisoformat(useful['start_utc'])-timedelta(minutes=29)
            with patch('services.notification_runner.now_utc',return_value=fixed),patch('services.notification_runner.current_events',return_value={'events':[]}),patch('services.notification_runner.process_outbox'):
                actual=run_once(engine);assert actual['generated']==1,actual
                assert run_once(engine)['generated']==0
            event_subscription=request('POST','/api/account/alert-subscriptions',201,json={'kind':'event','target_id':'earthquake'}).json()['id']
            with Session(engine) as db:
                db.get(NotificationPreferences,users[1]).natural_event_alerts=True;db.commit()
            with patch('services.notification_runner.prediction',return_value={'state':'unavailable','windows':[]}),patch('services.notification_runner.current_events',return_value={'events':[event]}),patch('services.notification_runner.process_outbox'):
                assert run_once(engine)['generated']==1
                assert run_once(engine)['generated']==0
            # No configuration: queue is preserved for later, not reported rejected.
            with patch('services.notification_runner.configuration',return_value=None):process_outbox(engine,'unused',time.monotonic()+1,lambda *_:None)
            # Runner heartbeat; no network providers are invoked by this fixture.
            with patch('services.notification_runner.prediction',return_value={'state':'unavailable','windows':[]}),patch('services.notification_runner.current_events',return_value={'events':[]}):
                result=run_once(engine);assert result['state']=='completed'
                assert run_once(engine)['generated']==0
            assert request('GET','/api/account/notification-delivery').json()['scheduler_state']=='recent_success'
            assert request('GET','/api/account/notifications',who=2).json()['items']==[]
            request('DELETE','/api/account/push-subscriptions/'+device,204)
            assert request('GET','/api/account/notification-delivery').json()['devices']==[]
            if postgres:
                with engine.connect() as db:
                    assert db.scalar(text("SELECT count(*) FROM pg_class WHERE relname IN ('account_push_devices','notification_runner_state','account_notification_delivery') AND relrowsecurity"))==3
                with psycopg.connect(host='127.0.0.1',port=55444,user='orbitwatch_test',dbname='orbitwatch_delivery_test',autocommit=True) as db:
                    db.execute((ROOT/'backend/migrations/005_notification_delivery.sql').read_text(),prepare=False)
                with psycopg.connect(host='127.0.0.1',port=55444,user='orbitwatch_test',dbname='orbitwatch_delivery_test',autocommit=True) as db:
                    db.execute('CREATE ROLE delivery_browser_fixture NOLOGIN')
                    db.execute('GRANT USAGE ON SCHEMA public TO delivery_browser_fixture')
                    db.execute('GRANT SELECT ON account_push_devices,account_notification_delivery,notification_runner_state TO delivery_browser_fixture')
                    db.execute('SET ROLE delivery_browser_fixture')
                    for table in ('account_push_devices','account_notification_delivery','notification_runner_state'):assert db.execute('SELECT count(*) FROM '+table).fetchone()[0]==0
                    db.execute('RESET ROLE')
                    db.execute('DROP OWNED BY delivery_browser_fixture');db.execute('DROP ROLE delivery_browser_fixture')
                assert request('GET','/api/account/notification-delivery').json()['last_success_at']
            print(f'PASS: policy/warnings/DST/events, owner-isolated encrypted push API, atomic inbox/ledger, dismissal+eviction dedup, overlap fencing, committed send/unknown crash outcomes, heartbeat; {checks} HTTP checks; {engine.dialect.name}',flush=True)
            if serve:
                # Browser smoke intentionally shows real unconfigured push status.
                for key in config:os.environ.pop(key,None)
                import uvicorn
                async def isolated(scope,receive,send):
                    if scope['type']=='http' and (scope['path'].startswith('/api/weather') or scope['path'].startswith('/api/events')):
                        from starlette.responses import JSONResponse
                        return await JSONResponse({'detail':'Providers disabled in isolated browser fixture'},503)(scope,receive,send)
                    return await app(scope,receive,send)
                print('Disposable UI: delivery_fixture1 / Disposable-delivery-2026',flush=True)
                uvicorn.run(isolated,host='127.0.0.1',port=8001,log_level='warning')
            client.close();engine.dispose()


if __name__=='__main__':run('--postgres' in sys.argv,'--serve' in sys.argv)
