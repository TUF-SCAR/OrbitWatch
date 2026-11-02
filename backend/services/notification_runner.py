"""Trusted bounded one-shot pipeline. No dependency on an open browser.

Run on the persistent ingestion host/shared cache volume. Default is cache-only;
do not enable new provider fetching on independent ephemeral cron hosts.
"""
from contextlib import contextmanager
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import os
import time
from types import SimpleNamespace
from uuid import uuid4
import socket
from sqlalchemy import delete,func,or_,select,text,update
from sqlalchemy.orm import Session
from core.database import database_engine
from models.user import User
from models.account import ObservationLocation,NotificationPreferences
from models.alerts import AlertSubscription,InboxNotification
from models.notification_delivery import PushDevice,NotificationDelivery,NotificationRun
from models.satellite_orbital_data import SatelliteOrbitalData
from schemas.alerts import TrustedNotificationInput
from services.account_inbox import store_notification,utc
from services.notification_policy import quiet,distance,astronomy_candidate,event_candidate,digest
from services.visibility import prediction
from services.visibility_forecast import forecast
from services.natural_events import current_events
from services.browser_push import configuration,send_push

LEASE_SECONDS=90
MAX_USERS=25
MAX_LEDGER=1000


def provider_host_fingerprint():
    from services.weather import cache
    return sha256((socket.gethostname()+'|'+str(cache.root.resolve())).encode()).hexdigest()[:16]


def now_utc():return datetime.now(timezone.utc)


@contextmanager
def lease(engine,mode='once'):
    """PG session advisory lock plus durable fencing; SQLite lease for fixtures."""
    token=str(uuid4());connection=None;owned=False
    try:
        if engine.dialect.name=='postgresql':
            connection=engine.connect()
            if not connection.scalar(text('SELECT pg_try_advisory_lock(68270707)')):
                yield None;return
            connection.commit();owned=True
        with Session(engine) as db:
            from sqlalchemy.dialects.postgresql import insert as pg_insert
            from sqlalchemy.dialects.sqlite import insert as sqlite_insert
            insert=pg_insert if engine.dialect.name=='postgresql' else sqlite_insert
            db.execute(insert(NotificationRun).values(id=1,cursor_owner=0,evaluated=0,generated=0).on_conflict_do_nothing(index_elements=['id']))
            now=now_utc()
            row=db.execute(update(NotificationRun).where(NotificationRun.id==1,or_(NotificationRun.lease_until.is_(None),NotificationRun.lease_until<now))
                .values(token=token,lease_until=now+timedelta(seconds=LEASE_SECONDS),started_at=now,last_error=None,mode=mode))
            db.commit()
            if row.rowcount!=1:
                yield None;return
        yield token
    finally:
        # Normal exit releases the durable fence; hard process death leaves the
        # 90-second lease for bounded recovery. Never release another run's token.
        try:
            with Session(engine) as db:
                db.execute(update(NotificationRun).where(NotificationRun.id==1,NotificationRun.token==token).values(token=None,lease_until=None));db.commit()
        except Exception:pass
        if connection:
            try:
                if owned:connection.execute(text('SELECT pg_advisory_unlock(68270707)'));connection.commit()
            except Exception:connection.invalidate()
            finally:connection.close()


def fence(db,token):
    state=db.scalar(select(NotificationRun).where(NotificationRun.id==1).with_for_update())
    if not state or state.token!=token or not state.lease_until or utc(state.lease_until)<=now_utc():raise RuntimeError('Runner lease expired')
    return state


def preferences_allow(db,owner,kind,subscription_id,location_id,now,target_id=None,category=None):
    preferences=db.get(NotificationPreferences,owner)
    if not preferences or not preferences.notifications_enabled or not getattr(preferences,{'satellite':'satellite_alerts','celestial':'celestial_alerts','event':'natural_event_alerts'}[kind]):return False
    locations=list(db.scalars(select(ObservationLocation).where(ObservationLocation.owner_id==owner)))
    if not any(row.id==location_id for row in locations) or quiet(preferences,locations,now):return False
    subscription=db.get(AlertSubscription,subscription_id) if subscription_id else None
    return bool(subscription and subscription.owner_id==owner and subscription.kind==kind and (target_id is None or subscription.target_id==(category if kind=='event' else target_id)))


def persist(engine,token,owner,subscription_id,location_id,candidate,now):
    """Ledger and inbox commit atomically; durable dedup survives inbox eviction."""
    with Session(engine) as db:
        now=now_utc()
        fence(db,token)
        db.scalar(select(User).where(User.id==owner).with_for_update())
        if candidate['expires_at']<=now or not preferences_allow(db,owner,candidate['kind'],subscription_id,location_id,now,candidate['target_id'],candidate['category']):return False
        location=db.get(ObservationLocation,location_id)
        observer=candidate.get('observer')
        if observer and (abs(observer[0]-float(location.latitude))>1e-6 or abs(observer[1]-float(location.longitude))>1e-6 or observer[2]!=location.timezone or observer[3] is not None and observer[3]!=location.version):return False
        preferences=db.get(NotificationPreferences,owner)
        if candidate.get('warning_minutes') is not None and preferences.advance_warning_minutes!=candidate['warning_minutes']:return False
        if candidate.get('distance_km',0)>preferences.event_radius_km:return False
        # Bounded retention; nothing is deleted before it is long ineligible.
        db.execute(delete(NotificationDelivery).where(NotificationDelivery.owner_id==owner,NotificationDelivery.expires_at<now-timedelta(days=35)))
        if db.scalar(select(func.count()).select_from(NotificationDelivery).where(NotificationDelivery.owner_id==owner))>=MAX_LEDGER:return False
        if db.scalar(select(NotificationDelivery.id).where(NotificationDelivery.owner_id==owner,NotificationDelivery.dedup_key==digest(candidate))):return False
        if candidate['kind']!='event':
            previous=list(db.scalars(select(NotificationDelivery).where(NotificationDelivery.owner_id==owner,NotificationDelivery.kind==candidate['kind'],NotificationDelivery.target_id==candidate['target_id'],
                NotificationDelivery.opportunity_at.between(candidate['opportunity_at']-timedelta(minutes=20),candidate['opportunity_at']+timedelta(minutes=20))).limit(30)))
            if any(distance(row.latitude,row.longitude,float(location.latitude),float(location.longitude))<=10 for row in previous):return False
        payload=TrustedNotificationInput(kind=candidate['kind'],target_id=candidate['target_id'],title=candidate['title'],message=candidate['message'],source_at=candidate['source_at'],
            expires_at=candidate['expires_at'],location_id=location_id,dedup_key=candidate['key'])
        inbox=store_notification(db,owner,payload)
        devices=list(db.scalars(select(PushDevice).where(PushDevice.owner_id==owner).order_by(PushDevice.slot)))
        ledger=NotificationDelivery(owner_id=owner,dedup_key=digest(candidate),kind=candidate['kind'],target_id=candidate['target_id'],category=candidate['category'],
            subscription_id=subscription_id,location_id=location_id,inbox_id=inbox.id,latitude=float(location.latitude),longitude=float(location.longitude),opportunity_at=candidate['opportunity_at'],
            source_at=candidate['source_at'],source_url=candidate.get('source_url'),severity=candidate.get('severity'),expires_at=candidate['expires_at'],
            state='push_queued' if devices and configuration() else 'inbox_persisted',devices=[{'id':device.id,'state':'queued','attempts':0} for device in devices] if configuration() else [],next_attempt_at=now)
        db.add(ledger);db.commit()
        return True


def process_outbox(engine,token,deadline,send=send_push):
    """At-most-once after ambiguous transport/crash; retry only explicit rejection.

    Web Push has no idempotency receipt API. A crash after a committed 'sending'
    intent becomes 'unknown', never falsely accepted or blindly resent.
    """
    if not configuration():return
    with Session(engine) as db:
        identities=list(db.scalars(select(NotificationDelivery.id).where(NotificationDelivery.state.in_(['push_queued','push_retry','sending']),
            or_(NotificationDelivery.next_attempt_at.is_(None),NotificationDelivery.next_attempt_at<=now_utc())).order_by(NotificationDelivery.created_at).limit(50)))
    for identity in identities:
        if time.monotonic()>=deadline:return
        while time.monotonic()<deadline:
            device=None;payload=None;ttl=0
            with Session(engine) as db:
                fence(db,token);row=db.get(NotificationDelivery,identity);now=now_utc()
                if not row:break
                entries=[dict(item) for item in row.devices]
                for item in entries:
                    if item['state']=='sending':item['state']='unknown'
                if utc(row.expires_at)<=now:
                    for item in entries:
                        if item['state'] in ('queued','retry'):item['state']='expired'
                    row.state='push_expired';row.devices=entries;db.commit();break
                db.scalar(select(User).where(User.id==row.owner_id).with_for_update())
                inbox=db.get(InboxNotification,row.inbox_id) if row.inbox_id else None
                if not inbox or inbox.dismissed_at or not preferences_allow(db,row.owner_id,row.kind,row.subscription_id,row.location_id,now,row.target_id,row.category):
                    row.state='suppressed';row.devices=entries;db.commit();break
                item=next((item for item in entries if item['state'] in ('queued','retry') and item.get('next_at',0)<=now.timestamp()),None)
                if item is None:
                    states={entry['state'] for entry in entries}
                    row.state='push_retry' if 'retry' in states else 'push_unknown' if 'unknown' in states else 'push_accepted' if 'accepted' in states else 'push_rejected'
                    row.devices=entries;row.next_attempt_at=min((datetime.fromtimestamp(entry['next_at'],timezone.utc) for entry in entries if entry['state']=='retry'),default=None)
                    db.commit();break
                device=db.get(PushDevice,item['id'])
                if not device or device.owner_id!=row.owner_id:
                    item['state']='revoked';row.devices=entries;db.commit();continue
                item['state']='sending';item['attempts']+=1;row.devices=entries;row.state='sending'
                payload={'id':row.id,'title':inbox.title,'body': 'A genuine viewing or source update is available in your private OrbitWatch inbox.',
                    'device_id':device.id,'kind':row.kind,'target_id':row.target_id,'expires_at':utc(row.expires_at).isoformat()}
                ttl=int((utc(row.expires_at)-now).total_seconds());device=SimpleNamespace(id=device.id,encrypted_subscription=device.encrypted_subscription)
                db.commit()  # Never send from an uncommitted notification or intent.
            outcome='unknown';retry=0;invalid=False
            try:
                send(device,payload,ttl);outcome='accepted'
            except Exception as error:
                response=getattr(error,'response',None);code=getattr(error,'status_code',None) or (response.status_code if response is not None else None)
                if code in (404,410):outcome='rejected';invalid=True
                elif code in (429,500,502,503,504):
                    outcome='retry';retry=300
                    try:retry=max(retry,min(86400,float(response.headers.get('Retry-After','300'))))
                    except (ValueError,TypeError,AttributeError):pass
                elif code is not None:outcome='rejected'
                # No response may mean accepted before transport failed: ambiguous.
            with Session(engine) as db:
                fence(db,token);row=db.get(NotificationDelivery,identity);entries=[dict(entry) for entry in row.devices]
                item=next(entry for entry in entries if entry['id']==device.id)
                if outcome=='retry' and item['attempts']>=4:outcome='rejected'
                item['state']=outcome
                if outcome=='retry':item['next_at']=now_utc().timestamp()+retry*2**(item['attempts']-1)
                row.devices=entries;row.state='push_queued'
                if invalid:db.execute(delete(PushDevice).where(PushDevice.id==device.id,PushDevice.owner_id==row.owner_id))
                db.commit()


def evaluate_owner(engine,token,owner,now,deadline,events):
    with Session(engine) as db:
        pref=db.get(NotificationPreferences,owner)
        locations=list(db.scalars(select(ObservationLocation).where(ObservationLocation.owner_id==owner).order_by(ObservationLocation.is_default.desc(),ObservationLocation.slot)))
        subscriptions=list(db.scalars(select(AlertSubscription).where(AlertSubscription.owner_id==owner).order_by(AlertSubscription.kind,AlertSubscription.slot)))
        if not pref or not pref.notifications_enabled or not locations or quiet(pref,locations,now):return 0
        # Keep detached immutable snapshots; release DB before expensive geometry.
        pref=SimpleNamespace(**{column.name:getattr(pref,column.name) for column in pref.__table__.columns})
        locations=[SimpleNamespace(**{column.name:getattr(row,column.name) for column in row.__table__.columns}) for row in locations]
        subscriptions=[SimpleNamespace(**{column.name:getattr(row,column.name) for column in row.__table__.columns}) for row in subscriptions]
        records={str(row.norad_id):SimpleNamespace(**{key:getattr(row,key) for key in ('norad_id','object_name','epoch','source','tle_line1','tle_line2')}) for row in db.scalars(select(SatelliteOrbitalData).where(SatelliteOrbitalData.norad_id.in_([int(s.target_id) for s in subscriptions if s.kind=='satellite'])))}
    generated=0;weather={};owner_deadline=min(deadline,time.monotonic()+8)
    pairs=[(sub,location) for sub in subscriptions if sub.kind in ('satellite','celestial') and getattr(pref,sub.kind+'_alerts') for location in locations]
    if pairs:
        offset=(int(now.timestamp())//300*12)%len(pairs);pairs=(pairs[offset:]+pairs[:offset])[:140]
    for sub,location in pairs:
        if time.monotonic()>=owner_deadline or generated>=5:break
        loc={'latitude':float(location.latitude),'longitude':float(location.longitude),'timezone':location.timezone}
        # Only two hours are needed for 10/30/60-minute advance notifications.
        # This reuses the preview engine while avoiding 24-hour work per run.
        result=prediction(sub.kind,sub.target_id,records.get(sub.target_id),loc,now,2,None)
        if astronomy_candidate(sub.kind,sub.target_id,sub.target_name,result,location,pref,now) is None:continue
        if location.id not in weather:
            weather[location.id]=forecast(loc['latitude'],loc['longitude'])
        candidate=astronomy_candidate(sub.kind,sub.target_id,sub.target_name,result,location,pref,now,weather.get(location.id))
        if candidate:generated+=persist(engine,token,owner,sub.id,location.id,candidate,now)
    if pref.natural_event_alerts:
        by_category={sub.target_id:sub for sub in subscriptions if sub.kind=='event'}
        with Session(engine) as db:
            event_severity=dict(db.execute(select(NotificationDelivery.target_id,func.max(NotificationDelivery.severity)).where(NotificationDelivery.owner_id==owner,NotificationDelivery.kind=='event').group_by(NotificationDelivery.target_id)).all())
        for event in events[:600]:
            if time.monotonic()>=owner_deadline or generated>=5:break
            sub=by_category.get(event.get('category'))
            if not sub:continue
            previous=event_severity.get(event['id'])
            # One report alert/account, associated with closest relevant saved point.
            for location in sorted(locations,key=lambda point:distance(float(point.latitude),float(point.longitude),*(list(reversed(event.get('position') or [0,0]))))):
                candidate=event_candidate(event,location,pref.event_radius_km,now,previous)
                if candidate:
                    generated+=persist(engine,token,owner,sub.id,location.id,candidate,now);break
    return generated


def run_once(engine=None,mode='once'):
    engine=engine or database_engine
    # Cache-only always by default. Upstream fetching is an explicit same-host
    # deployment choice; notification workers NEVER refresh orbital/event feeds.
    if os.getenv('ORBITWATCH_NOTIFICATION_PROVIDER_REQUESTS','false').lower()!='true':
        os.environ['ORBITWATCH_WEATHER_PROVIDER_REQUESTS']='false'
    else:
        from services.weather import cache
        if os.getenv('ORBITWATCH_NOTIFICATION_HOST_ID')!=provider_host_fingerprint() or not (cache.root/'cache.sqlite3').is_file():
            raise RuntimeError('Provider fetching requires the designated persistent ingestion host and existing shared cache')
    started=time.monotonic();deadline=started+55;now=now_utc();evaluated=generated=0
    with lease(engine,mode) as token:
        if token is None:return {'state':'overlap_skipped','evaluated':0,'generated':0}
        try:
            with Session(engine) as db:
                if engine.dialect.name=='postgresql' and db.scalar(text('SELECT pg_database_size(current_database())'))>=299_000_000:
                    raise RuntimeError('Notification storage reserve reached')
                state=db.get(NotificationRun,1);cursor=state.cursor_owner
                def batch(after):return list(db.scalars(select(NotificationPreferences.owner_id).where(NotificationPreferences.notifications_enabled.is_(True),NotificationPreferences.owner_id>after).order_by(NotificationPreferences.owner_id).limit(MAX_USERS)))
                owners=batch(cursor) or batch(0)
            events=current_events(schedule=False)['events'] if owners else []
            for owner in owners:
                if time.monotonic()>=deadline-8:break
                generated+=evaluate_owner(engine,token,owner,now,deadline-8,events);evaluated+=1;cursor=owner
            process_outbox(engine,token,deadline)
            with Session(engine) as db:
                state=fence(db,token);state.cursor_owner=cursor;state.last_success_at=now_utc();state.lease_until=None;state.token=None
                state.evaluated=evaluated;state.generated=generated;state.last_error=None;db.commit()
            return {'state':'completed','evaluated':evaluated,'generated':generated}
        except BaseException as error:
            try:
                with Session(engine) as db:
                    state=fence(db,token);state.last_error='interrupted' if isinstance(error,(KeyboardInterrupt,SystemExit)) else 'run_failed';state.lease_until=None;state.token=None;db.commit()
            except Exception:pass  # Durable lease expires after process/DB failure.
            raise
