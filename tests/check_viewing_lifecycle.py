"""Real private schedule -> independent stages -> inbox; disposable SQLite, HTTP0."""
from datetime import datetime,timedelta,timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
import copy,os,sys
import threading
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'backend'))

with TemporaryDirectory() as tmp,patch('dotenv.load_dotenv',return_value=False),patch.dict(os.environ,{'DATABASE_URL':f'sqlite:///{Path(tmp).as_posix()}/fixture.db','JWT_SECRET_KEY':'isolated-lifecycle-key','ORBITWATCH_INGESTION_ENABLED':'false','ORBITWATCH_EVENT_PROVIDER_REQUESTS':'false','ORBITWATCH_SMALL_BODY_PROVIDER_REQUESTS':'false','ORBITWATCH_NOTIFICATION_PROVIDER_REQUESTS':'false','ORBITWATCH_WEATHER_PROVIDER_REQUESTS':'false'}):
    from sqlalchemy import select,func
    from sqlalchemy.orm import Session
    from core.database import DatabaseBase,database_engine as engine
    from models.user import User
    from models.account import ObservationLocation,NotificationPreferences
    from models.alerts import AlertSubscription,InboxNotification
    from models.notification_delivery import NotificationRun,NotificationDelivery,PushDevice
    from models.viewing_opportunity import ViewingOpportunity,VisibilityPlan
    from models.satellite_orbital_data import SatelliteOrbitalData
    from services import notification_runner as runner
    from services.viewing_score import assessment,compass
    from services.viewing_plans import schedule_result,source_key
    from services import viewing_plans as plans
    from services.notification_policy import opportunity_candidate
    from services.account_inbox import utc
    DatabaseBase.metadata.create_all(engine)
    with Session(engine) as db:
        user=User(username='isolated',email='isolated@example.invalid',password_hash='not-a-login');db.add(user);db.flush()
        pref=NotificationPreferences(owner_id=user.id,notifications_enabled=True,celestial_alerts=True);db.add(pref)
        location=ObservationLocation(owner_id=user.id,slot=1,name='Isolated observation point',latitude=40,longitude=-74,timezone='UTC',is_default=True);db.add(location);db.flush()
        sub=AlertSubscription(owner_id=user.id,kind='celestial',target_id='moon',target_name='Moon',slot=1);db.add(sub);db.commit()
        owner=user.id;locid=location.id;subid=sub.id
    now=datetime.now(timezone.utc).replace(microsecond=0);start=now+timedelta(minutes=30);end=start+timedelta(minutes=20);clock=[now]
    geometry={'altitude_degrees':40.,'azimuth_degrees':315.,'sun_altitude_degrees':-25.,'sunlit':True}
    window={'start_utc':start.isoformat(),'end_utc':end.isoformat(),'maximum_at_utc':(start+timedelta(minutes=10)).isoformat(),'max_elevation_degrees':45.,'sun_altitude_degrees':-25.,'azimuth_degrees':315.,'start_azimuth_degrees':315.,'segment_precision_seconds':120,'window_clipped':False}
    result={'state':'available','source':'ISOLATED deterministic geometric fixture','computed_at':now.isoformat(),'windows':[window]}
    def dataset(*args,**kwargs):
        return {'retrieved_epoch':clock[0].timestamp(),'retrieved_at':clock[0].isoformat(),'provider':'isolated-forecast-fixture','attribution':'ISOLATED no provider requests',
                'rows':[{'valid_epoch':start.timestamp(),'cloud_cover_percent':10,'precipitation_probability_percent':5,'precipitation_mm':0}]}
    fresh=dataset();weather={'state':'available',**fresh['rows'][0]}
    assert compass(359)=='N' and compass(315)=='NW'
    score=assessment('celestial','moon',geometry,weather)
    assert 0<=score['score']<=100 and score['eligible_geometry'] and score['direction']=='NW'
    assert assessment('celestial','moon',geometry,{'state':'unavailable'})['score'] is None
    assert assessment('satellite','20580',geometry,weather)['score'] is None
    assert assessment('celestial','moon',{**geometry,'altitude_degrees':-1},weather)['score']==0
    assert assessment('satellite','25544',{**geometry,'sunlit':False},weather)['eligible_geometry'] is False
    assert assessment('satellite','25544',{**geometry,'sun_altitude_degrees':10},weather)['eligible_geometry'] is False
    entered=threading.Event();release=threading.Event();computations=[]
    def compute_once(*args):computations.append(1);entered.set();assert release.wait(5);return result
    with patch.object(plans,'prediction',side_effect=compute_once),ThreadPoolExecutor(max_workers=4) as pool:
        arguments=(engine,'celestial','venus',None,{'latitude':40,'longitude':-74,'timezone':'UTC'},now,24)
        owner_future=pool.submit(plans.shared_prediction,*arguments);assert entered.wait(5)
        waiting=list(pool.map(lambda _:plans.shared_prediction(*arguments),range(12)))
        assert all(item['state']=='unavailable' for item in waiting)
        release.set();assert owner_future.result()['state']=='available';assert len(computations)==1
        assert plans.shared_prediction(*arguments)['state']=='available';assert len(computations)==1
    with patch.object(runner,'now_utc',side_effect=lambda:clock[0]),patch.object(runner,'shared_prediction',return_value=result),patch.object(runner,'forecast',side_effect=dataset),patch.object(runner,'instant_geometry',return_value=geometry),patch.object(runner,'current_events',return_value={'events':[]}),patch.object(runner,'configuration',return_value=None):
        assert runner.run_once(engine)['generated']==1
        assert runner.run_once(engine)['generated']==0 # Restart/tick cannot repeat advance.
        with Session(engine) as db:
            row=db.scalar(select(ViewingOpportunity));identity=row.id
            assert row.advance_state=='sent' and row.visible_state=='pending'
            # Small recalculation retains identity and stage state.
            shifted=copy.deepcopy(result);shifted['windows'][0]['start_utc']=(start+timedelta(seconds=20)).isoformat()
            schedule_result(db,owner,db.get(AlertSubscription,subid),db.get(ObservationLocation,locid),db.get(NotificationPreferences,owner),None,shifted,now)
            db.commit();assert db.scalar(select(func.count()).select_from(ViewingOpportunity))==1
            assert db.get(ViewingOpportunity,identity).advance_state=='sent'
        clock[0]=start+timedelta(seconds=25)
        assert runner.run_once(engine)['generated']==1 # Advance does not suppress Visible Now.
        assert runner.run_once(engine)['generated']==0
        with Session(engine) as db:
            rows=list(db.scalars(select(NotificationDelivery)));assert {row.alert_stage for row in rows}=={'advance','visible_now'}
            assert all(row.opportunity_id==identity for row in rows)
            assert all(utc(row.expires_at)<start+timedelta(seconds=120) for row in rows)
            assert all(utc(item.expires_at)==end for item in db.scalars(select(InboxNotification)))
            assert db.scalar(select(func.count()).select_from(InboxNotification))==2
            assert rows[1].details['assessment']['score'] is not None
            opportunity=db.get(ViewingOpportunity,identity);loc=db.get(ObservationLocation,locid);pref=db.get(NotificationPreferences,owner)
            for minutes in (10,30,60):
                pref.advance_warning_minutes=minutes
                assert opportunity_candidate(opportunity,loc,pref,utc(opportunity.start_at)-timedelta(minutes=minutes),'advance',dataset())
            assert opportunity_candidate(opportunity,loc,pref,end+timedelta(seconds=1),'visible_now',dataset(),geometry) is None
            assert opportunity_candidate(opportunity,loc,pref,clock[0],'visible_now',None,geometry) is None
            bad=dataset();bad['rows'][0]['cloud_cover_percent']=95
            assert opportunity_candidate(opportunity,loc,pref,clock[0],'visible_now',bad,geometry) is None
            assert opportunity_candidate(opportunity,loc,pref,clock[0],'visible_now',dataset(),{**geometry,'altitude_degrees':-3}) is None
            old=dataset();old['retrieved_epoch']-=901
            assert opportunity_candidate(opportunity,loc,pref,clock[0],'visible_now',old,geometry) is None
        # Changed coordinates/source/preferences invalidate the durable row.
        with Session(engine) as db:
            row=db.get(ViewingOpportunity,identity);row.visible_state='pending';db.get(ObservationLocation,locid).version+=1;db.commit()
        assert runner.run_once(engine)['generated']==0
        with Session(engine) as db:assert db.get(ViewingOpportunity,identity).status=='invalidated'
    # Real authenticated-route contracts and account ownership on the new fields.
    from fastapi.testclient import TestClient
    from main import app
    from core.security import get_current_user
    with TestClient(app) as client:
        assert client.get('/api/account/visibility/targets/celestial').status_code==401
        app.dependency_overrides[get_current_user]=lambda:SimpleNamespace(id=owner)
        with patch('routes.visibility.shared_prediction',return_value=result):
            targets=client.get('/api/account/visibility/targets/celestial');assert targets.status_code==200
            assert all(item['state']=='potential' and item['locations'][0]['location_id']==locid for item in targets.json()['items'])
        messages=client.get('/api/account/notifications');assert messages.status_code==200
        assert {item['alert_stage'] for item in messages.json()['items']}=={'advance','visible_now'}
        assert all(item['viewing_details']['assessment'] for item in messages.json()['items'])
        inbox_id=messages.json()['items'][0]['id']
        assert client.get('/api/account/notifications/'+inbox_id).json()['viewing_details']['assessment']
        app.dependency_overrides[get_current_user]=lambda:SimpleNamespace(id=999999)
        assert client.get('/api/account/notifications').json()['items']==[]
        assert client.get('/api/account/notifications/'+inbox_id).status_code==404
        with patch('routes.visibility.shared_prediction',side_effect=AssertionError('No location must not compute')):
            assert all(item['state']=='insufficient_data' for item in client.get('/api/account/visibility/targets/celestial').json()['items'])
        app.dependency_overrides.clear()
    engine.dispose()
print('PASS score hard gates/partial inputs/unknown brightness/compass; durable advance + Visible Now independently persist; repeat/restart/20s shift dedup; 10/30/60 leads; expired/poor/missing/stale weather suppressed; location invalidation; HTTP0')
