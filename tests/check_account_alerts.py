"""Focused real auth/API/migrations. Fixed disposable targets; never loads .env."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
import os
from pathlib import Path
import secrets
import sys
import tempfile
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'backend'))


def run(postgres=False,serve=False):
    with tempfile.TemporaryDirectory(prefix='orbitwatch-alerts-') as scratch:
        url=f"sqlite:///{Path(scratch).as_posix()}/alerts.db"
        if postgres:
            import psycopg
            with psycopg.connect(host='127.0.0.1',port=55434,user='orbitwatch_test',dbname='postgres',autocommit=True) as db:
                db.execute('DROP DATABASE IF EXISTS orbitwatch_alerts_test WITH (FORCE)');db.execute('CREATE DATABASE orbitwatch_alerts_test')
            url='postgresql+psycopg://orbitwatch_test@127.0.0.1:55434/orbitwatch_alerts_test'
        with patch('dotenv.load_dotenv',return_value=False),patch.dict(os.environ,{'DATABASE_URL':url,'JWT_SECRET_KEY':secrets.token_hex(32),'ORBITWATCH_INGESTION_ENABLED':'false','CORS_ALLOWED_ORIGINS':'http://127.0.0.1:5174'}):
            from sqlalchemy import select,text,delete,func,event
            from sqlalchemy.exc import IntegrityError
            from core.database import DatabaseBase,database_engine as engine,database_session_maker
            from models.user import User
            from models.account import ObservationLocation,NotificationPreferences
            from models.alerts import AlertSubscription,InboxNotification
            from models.satellite_orbital_data import SatelliteOrbitalData,SatelliteOrbitalDataHistory
            from schemas.alerts import TrustedNotificationInput
            from services.account_inbox import store_notification
            from services.account_targets import SATELLITES,CELESTIAL,EVENTS
            from main import app
            from fastapi.testclient import TestClient
            if not postgres:
                @event.listens_for(engine,'connect')
                def foreign_keys(connection,record):connection.execute('PRAGMA foreign_keys=ON')
            DatabaseBase.metadata.create_all(engine,tables=[User.__table__,SatelliteOrbitalData.__table__,SatelliteOrbitalDataHistory.__table__])
            client=TestClient(app,raise_server_exceptions=False);auth={};ids={};checks=0
            def req(method,path,status=200,who=1,**kw):
                nonlocal checks
                response=client.request(method,'/api/account'+path,headers=auth.get(who,{}),**kw)
                assert response.status_code==status,(path,response.status_code,response.text[:220]);checks+=1
                assert 'Traceback' not in response.text and 'password_hash' not in response.text
                return response
            for n in (1,2):
                r=client.post('/api/auth/register',json={'username':f'alerts_fixture{n}','email':f'alerts{n}@example.invalid','password':'Disposable-alerts-2026'});assert r.status_code==201
                auth[n]={'Authorization':'Bearer '+r.json()['access_token']};ids[n]=client.get('/api/auth/me',headers=auth[n]).json()['id']
            for path in ('/alert-subscriptions','/notifications','/notifications/unread-count'):req('GET',path,401,who=0);req('GET',path,503)
            assert client.get('/health/ready').status_code==200
            assert client.get('/api/satellites/catalog',headers=auth[1]).status_code==200
            migrations=[(ROOT/'backend/migrations'/name).read_text(encoding='utf-8') for name in ('002_account_notification_foundation.sql','003_account_alert_subscriptions.sql','004_account_notification_inbox.sql')]
            if postgres:
                with psycopg.connect(host='127.0.0.1',port=55434,user='orbitwatch_test',dbname='orbitwatch_alerts_test',autocommit=True) as db:
                    for sql in migrations:db.execute(sql,prepare=False);db.execute(sql,prepare=False)
            else:
                for model in (ObservationLocation,NotificationPreferences,AlertSubscription,InboxNotification):model.__table__.create(engine)
            assert req('GET','/alert-subscriptions').json()==[]
            assert req('GET','/notifications/unread-count').json()['unread_count']==0
            a=req('POST','/alert-subscriptions',201,json={'kind':'satellite','target_id':'20580'}).json()
            assert req('POST','/alert-subscriptions',json={'kind':'satellite','target_id':'20580'}).json()['id']==a['id']
            req('DELETE',f"/alert-subscriptions/{a['id']}",204,who=2)
            assert len(req('GET','/alert-subscriptions').json())==1
            for kind,identity in [('satellite','999999999'),('satellite','https://example.invalid'),('celestial','earth'),('celestial','sun'),('celestial','io'),('event','not_a_category')]:req('POST','/alert-subscriptions',422,json={'kind':kind,'target_id':identity})
            req('POST','/alert-subscriptions',422,json={'kind':'celestial','target_id':'moon','owner_id':ids[2]})
            for identity in CELESTIAL:req('POST','/alert-subscriptions',201,json={'kind':'celestial','target_id':identity})
            for identity in EVENTS:req('POST','/alert-subscriptions',201,json={'kind':'event','target_id':identity})
            for identity in [key for key in SATELLITES if key!='20580'][:19]:req('POST','/alert-subscriptions',201,json={'kind':'satellite','target_id':identity})
            additional=next(key for key in SATELLITES if key not in {row['target_id'] for row in req('GET','/alert-subscriptions').json()})
            req('POST','/alert-subscriptions',409,json={'kind':'satellite','target_id':additional})
            assert req('GET','/notification-preferences').json()['notifications_enabled'] is False
            assert len(req('GET','/alert-subscriptions').json())==41
            req('DELETE',f"/alert-subscriptions/{a['id']}",204);req('DELETE',f"/alert-subscriptions/{a['id']}",204)
            if postgres:
                keys=list(SATELLITES)
                for identity in keys[:18]:req('POST','/alert-subscriptions',201,who=2,json={'kind':'satellite','target_id':identity})
                with ThreadPoolExecutor(max_workers=8) as pool:
                    statuses=list(pool.map(lambda identity:client.post('/api/account/alert-subscriptions',headers=auth[2],json={'kind':'satellite','target_id':identity}).status_code,keys[18:26]))
                assert sorted(statuses)==[201]*2+[409]*6,statuses
            print('PASS: canonical 143-object Live catalog, deliberate subscriptions, duplicate/idempotent unfollow, limits, concurrent requests and owner isolation')
            location=req('POST','/locations',201,json={'name':'Isolated fixture point','latitude':0,'longitude':0,'timezone':'UTC'}).json()
            now=datetime.now(timezone.utc)
            def payload(key,kind='satellite',target='20580',expired=False):return TrustedNotificationInput(kind=kind,target_id=target,title='ISOLATED TEST — observation update',message='Disposable test record, never a production prediction.',source_at=now-timedelta(minutes=10),expires_at=now+timedelta(minutes=-1 if expired else 60),dedup_key=key)
            with database_session_maker() as db:
                records=[store_notification(db,ids[1],payload('satellite').model_copy(update={'location_id':__import__('uuid').UUID(location['id'])})),store_notification(db,ids[1],payload('planet','celestial','jupiter',True)),store_notification(db,ids[1],payload('event','event','usgs:fixture-test'))]
                record_ids=[row.id for row in records];db.commit()
                assert store_notification(db,ids[1],payload('satellite')).id==record_ids[0];db.commit()
                old=store_notification(db,ids[1],payload('old'));old.created_at=now-timedelta(days=31);db.commit()
                try:store_notification(db,ids[2],payload('foreign').model_copy(update={'location_id':__import__('uuid').UUID(location['id'])}))
                except ValueError:db.rollback()
                else:raise AssertionError('foreign location accepted')
            for target in ('https://evil.invalid','javascript:alert(1)','usgs:../../secret'):
                try:payload('unsafe','event',target)
                except ValueError:pass
                else:raise AssertionError('untrusted navigation accepted')
            req('POST','/notifications',405,json={'title':'cannot fabricate'})
            req('GET','/notifications?limit=51',422);req('GET','/notifications?cursor=bad_cursor',422)
            page=req('GET','/notifications?limit=2').json();assert len(page['items'])==2 and page['next_cursor'] and page['unread_count']==3
            next_page=req('GET','/notifications?limit=2&cursor='+page['next_cursor']).json();assert len(next_page['items'])==1
            assert not {row['id'] for row in page['items']} & {row['id'] for row in next_page['items']}
            all_items=page['items']+next_page['items'];assert sum(row['is_expired'] for row in all_items)==1
            assert all(set(row['destination'])=={'kind','target_id'} for row in all_items)
            assert req('GET','/notifications',who=2).json()['items']==[]
            req('PUT',f'/notifications/{record_ids[0]}/read',404,who=2)
            read=req('PUT',f'/notifications/{record_ids[0]}/read').json();assert read['unread_count']==2
            assert req('PUT',f'/notifications/{record_ids[0]}/read').json()['read_at']==read['read_at']
            req('DELETE',f'/notifications/{record_ids[1]}',who=2);assert req('GET','/notifications/unread-count').json()['unread_count']==2
            assert req('POST','/notifications/read-all').json()['unread_count']==0
            assert req('POST','/notifications/read-all').json()['unread_count']==0
            req('DELETE',f'/notifications/{record_ids[0]}');req('DELETE',f'/notifications/{record_ids[0]}')
            with database_session_maker() as db:
                assert store_notification(db,ids[1],payload('satellite')).dismissed_at is not None
                for i in range(205):store_notification(db,ids[1],payload(f'bounded-{i}'))
                db.commit();assert db.scalar(select(func.count()).select_from(InboxNotification).where(InboxNotification.owner_id==ids[1]))==200
                assert db.scalar(select(InboxNotification).where(InboxNotification.dedup_key==__import__('hashlib').sha256(b'old').hexdigest())) is None
            print('PASS: trusted-only inbox writes, retention/cap/dedup, owner filtering, cursor pagination, real counts, expired states and safe destinations')
            for model,values in ((AlertSubscription,{'owner_id':ids[1],'kind':'satellite','target_id':'999999999','target_name':'Invalid','slot':1}),(InboxNotification,{'owner_id':ids[2],'slot':201,'kind':'satellite','target_id':'20580','title':'Invalid slot','message':'Fixture','source_at':now,'dedup_key':'x'*64})):
                with engine.connect() as db:
                    tx=db.begin()
                    try:db.execute(model.__table__.insert().values(**values))
                    except IntegrityError:tx.rollback()
                    else:raise AssertionError('database invariant not enforced')
            if postgres:
                with psycopg.connect(host='127.0.0.1',port=55434,user='orbitwatch_test',dbname='orbitwatch_alerts_test',autocommit=True) as db:
                    for sql in migrations:db.execute(sql,prepare=False)
                    db.execute("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='alerts_browser_fixture') THEN CREATE ROLE alerts_browser_fixture NOLOGIN; END IF; END $$")
                    db.execute('GRANT USAGE ON SCHEMA public TO alerts_browser_fixture');db.execute('GRANT SELECT ON account_alert_subscriptions,account_notification_inbox TO alerts_browser_fixture');db.execute('SET ROLE alerts_browser_fixture')
                    for table in ('account_alert_subscriptions','account_notification_inbox'):assert db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]==0
                    db.execute('RESET ROLE')
            assert client.get('/health/ready').status_code==200 and client.get('/api/auth/me',headers=auth[1]).status_code==200
            print('PASS: additive migration reapplication, DB constraints/RLS and preserved auth/readiness; HTTP CHECKS',checks,flush=True)
            if serve:
                # Isolated test fixtures only. Never run on configured production.
                with database_session_maker() as db:
                    db.execute(delete(AlertSubscription));db.execute(delete(InboxNotification));db.commit()
                    store_notification(db,ids[1],payload('ui-satellite'));store_notification(db,ids[1],payload('ui-expired','celestial','jupiter',True));db.commit()
                from fastapi.responses import JSONResponse
                async def isolated_app(scope,receive,send):
                    if scope['type']=='http' and scope.get('path','').startswith(('/api/weather','/api/events')):
                        return await JSONResponse({'detail':'External providers disabled in isolated account UI verification.'},status_code=503)(scope,receive,send)
                    return await app(scope,receive,send)
                print('DISPOSABLE UI: alerts_fixture1 / Disposable-alerts-2026',flush=True)
                import uvicorn
                uvicorn.run(isolated_app,host='127.0.0.1',port=8001,access_log=False)
            client.close();engine.dispose()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--postgres',action='store_true');parser.add_argument('--serve',action='store_true');args=parser.parse_args();run(args.postgres,args.serve)
