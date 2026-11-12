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
from sqlalchemy import case,delete,func,or_,select,text,update
from sqlalchemy.orm import Session
from core.database import database_engine
from models.user import User
from models.account import ObservationLocation,NotificationPreferences
from models.alerts import AlertSubscription,InboxNotification
from models.notification_delivery import PushDevice,NotificationDelivery,NotificationRun
from models.viewing_opportunity import ViewingOpportunity,VisibilityPlan
from models.satellite_orbital_data import SatelliteOrbitalData
from schemas.alerts import TrustedNotificationInput
from services.account_inbox import store_notification,utc
from services.notification_policy import quiet,distance,astronomy_candidate,event_candidate,digest
from services.event_geometry import proximity
from services.visibility import prediction
from services.visibility_forecast import forecast
from services.natural_events import current_events
from services.browser_push import configuration,send_push
from services.viewing_plans import shared_prediction,schedule_result,source_key
from services.visibility import instant_geometry
from services.notification_policy import opportunity_candidate

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
        if candidate['expires_at']<=now or candidate.get('push_expires_at',candidate['expires_at'])<=now or not preferences_allow(db,owner,candidate['kind'],subscription_id,location_id,now,candidate['target_id'],candidate['category']):return False
        location=db.get(ObservationLocation,location_id)
        observer=candidate.get('observer')
        if observer and (abs(observer[0]-float(location.latitude))>1e-6 or abs(observer[1]-float(location.longitude))>1e-6 or observer[2]!=location.timezone or observer[3] is not None and observer[3]!=location.version):return False
        preferences=db.get(NotificationPreferences,owner)
        if candidate.get('warning_minutes') is not None and preferences.advance_warning_minutes!=candidate['warning_minutes']:return False
        if candidate.get('distance_km',0)>preferences.event_radius_km:return False
        # Bounded retention; nothing is deleted before it is long ineligible.
        # Long-running incident update keys must survive inbox cleanup/restarts.
        # Preserve event ledgers; the existing hard cap prevents unbounded growth.
        db.execute(delete(NotificationDelivery).where(NotificationDelivery.owner_id==owner,NotificationDelivery.kind!='event',NotificationDelivery.expires_at<now-timedelta(days=35)))
        if db.scalar(select(func.count()).select_from(NotificationDelivery).where(NotificationDelivery.owner_id==owner))>=MAX_LEDGER:return False
        if db.scalar(select(NotificationDelivery.id).where(NotificationDelivery.owner_id==owner,NotificationDelivery.dedup_key==digest(candidate))):return False
        if candidate['kind']!='event' and not candidate.get('opportunity_id'):
            previous=list(db.scalars(select(NotificationDelivery).where(NotificationDelivery.owner_id==owner,NotificationDelivery.kind==candidate['kind'],NotificationDelivery.target_id==candidate['target_id'],
                NotificationDelivery.opportunity_at.between(candidate['opportunity_at']-timedelta(minutes=20),candidate['opportunity_at']+timedelta(minutes=20))).limit(30)))
            if any(distance(row.latitude,row.longitude,float(location.latitude),float(location.longitude))<=10 for row in previous):return False
        payload=TrustedNotificationInput(kind=candidate['kind'],target_id=candidate['target_id'],title=candidate['title'],message=candidate['message'],source_at=candidate['source_at'],
            expires_at=candidate['expires_at'],location_id=location_id,dedup_key=candidate['key'])
        inbox=store_notification(db,owner,payload)
        devices=list(db.scalars(select(PushDevice).where(PushDevice.owner_id==owner).order_by(PushDevice.slot)))
        ledger=NotificationDelivery(owner_id=owner,dedup_key=digest(candidate),kind=candidate['kind'],target_id=candidate['target_id'],category=candidate['category'],
            alert_stage=candidate.get('alert_stage','event' if candidate['kind']=='event' else 'advance'),opportunity_id=candidate.get('opportunity_id'),details=candidate.get('details',{}),
            subscription_id=subscription_id,location_id=location_id,inbox_id=inbox.id,latitude=float(location.latitude),longitude=float(location.longitude),opportunity_at=candidate['opportunity_at'],
            source_at=candidate['source_at'],source_url=candidate.get('source_url'),severity=candidate.get('severity'),expires_at=candidate.get('push_expires_at',candidate['expires_at']),
            state='push_queued' if devices and configuration() else 'inbox_persisted',devices=[{'id':device.id,'state':'queued','attempts':0} for device in devices] if configuration() else [],next_attempt_at=now)
        db.add(ledger)
        if candidate.get('opportunity_id'):
            opportunity=db.get(ViewingOpportunity,candidate['opportunity_id'])
            if not opportunity or opportunity.owner_id!=owner or opportunity.location_id!=location_id or opportunity.status!='scheduled' or opportunity.location_version!=location.version or opportunity.preference_version!=preferences.version:return False
            stage='advance_state' if candidate['alert_stage']=='advance' else 'visible_state'
            if getattr(opportunity,stage)!='pending':return False
            setattr(opportunity,stage,'sent')
        db.commit()
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
                if row.opportunity_id:
                    loc=db.get(ObservationLocation,row.location_id);pref=db.get(NotificationPreferences,row.owner_id)
                    point=row.details.get('observer',{})
                    if not loc or row.details.get('location_version')!=loc.version or any(float(point.get(key,999))!=float(getattr(loc,key)) for key in ('latitude','longitude')) or row.alert_stage=='advance' and row.details.get('warning_minutes')!=pref.advance_warning_minutes:
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
                payload={'id':row.id,'title':'OrbitWatch viewing update' if row.kind!='event' else 'OrbitWatch source update','body': 'A genuine viewing or source update is available in your private OrbitWatch inbox.',
                    'device_id':device.id,'kind':row.kind,'target_id':row.target_id,'notification_id':inbox.id,'expires_at':utc(row.expires_at).isoformat()}
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
        record=records.get(sub.target_id)
        with Session(engine) as db:
            ready=db.scalar(select(ViewingOpportunity.id).where(ViewingOpportunity.owner_id==owner,ViewingOpportunity.subscription_id==sub.id,ViewingOpportunity.location_id==location.id,ViewingOpportunity.location_version==location.version,ViewingOpportunity.preference_version==pref.version,ViewingOpportunity.source_key==source_key(sub.kind,sub.target_id,record),ViewingOpportunity.status=='scheduled',ViewingOpportunity.refresh_at>now,ViewingOpportunity.end_at>now))
        if ready: continue
        result=shared_prediction(engine,sub.kind,sub.target_id,record,loc,now,6)
        with Session(engine) as db:
            fence(db,token)
            schedule_result(db,owner,sub,location,pref,record,result,now);db.commit()
    if pref.natural_event_alerts:
        by_category={sub.target_id:sub for sub in subscriptions if sub.kind=='event'}
        with Session(engine) as db:
            event_severity=dict(db.execute(select(NotificationDelivery.target_id,func.max(NotificationDelivery.severity)).where(NotificationDelivery.owner_id==owner,NotificationDelivery.kind=='event').group_by(NotificationDelivery.target_id)).all())
        for event in events[:1200]:
            if time.monotonic()>=owner_deadline or generated>=5:break
            sub=by_category.get(event.get('category'))
            if not sub:continue
            previous=event_severity.get(event['id'])
            # One report alert/account, associated with closest relevant saved point.
            def reported_distance(point):
                km=proximity(event.get('geometry') or {},float(point.latitude),float(point.longitude))
                return km if km is not None else float('inf')
            for location in sorted(locations,key=reported_distance):
                candidate=event_candidate(event,location,pref.event_radius_km,now,previous)
                if candidate:
                    generated+=persist(engine,token,owner,sub.id,location.id,candidate,now);break
    return generated


def dispatch_opportunities(engine,token,deadline):
    """Indexed lightweight due dispatch on every tick, independent of planning."""
    now=now_utc();generated=0;weather={}
    with Session(engine) as db:
        rows=list(db.scalars(select(ViewingOpportunity.id).where(ViewingOpportunity.status=='scheduled',ViewingOpportunity.end_at>now,
            or_((ViewingOpportunity.advance_state=='pending')&(ViewingOpportunity.advance_due_at<=now),(ViewingOpportunity.visible_state=='pending')&(ViewingOpportunity.visible_due_at<=now))).order_by(ViewingOpportunity.visible_due_at).limit(100)))
    for identity in rows:
        if time.monotonic()>=deadline: break
        with Session(engine) as db:
            row=db.get(ViewingOpportunity,identity);pref=db.get(NotificationPreferences,row.owner_id);loc=db.get(ObservationLocation,row.location_id)
            if not loc or not pref:continue
            record=db.scalar(select(SatelliteOrbitalData).where(SatelliteOrbitalData.norad_id==int(row.target_id))) if row.kind=='satellite' else None
            if row.location_version!=loc.version or row.preference_version!=pref.version or row.source_key!=source_key(row.kind,row.target_id,record):
                row.status='invalidated';db.commit();continue
            if not preferences_allow(db,row.owner_id,row.kind,row.subscription_id,row.location_id,now,row.target_id,row.kind):
                continue # Quiet hours may end before a future stage; never send late.
            row=SimpleNamespace(**{column.name:getattr(row,column.name) for column in row.__table__.columns})
            loc=SimpleNamespace(**{column.name:getattr(loc,column.name) for column in loc.__table__.columns})
            pref=SimpleNamespace(**{column.name:getattr(pref,column.name) for column in pref.__table__.columns})
            record=SimpleNamespace(**{key:getattr(record,key) for key in ('norad_id','object_name','epoch','source','tle_line1','tle_line2')}) if record else None
        for stage in ('advance','visible_now'):
            state='advance_state' if stage=='advance' else 'visible_state'
            if getattr(row,state)!='pending':continue
            start,end=utc(row.start_at),utc(row.end_at);due=start-timedelta(minutes=pref.advance_warning_minutes) if stage=='advance' else start
            if now<due:continue
            expiry=min(start,due+timedelta(minutes=10)) if stage=='advance' else min(end,start+timedelta(seconds=90))
            if now>=expiry:
                with Session(engine) as db:
                    fence(db,token);current=db.get(ViewingOpportunity,identity);setattr(current,state,'missed');db.commit()
                continue
            geometry=instant_geometry(row.kind,row.target_id,record,vars(loc),now) if stage=='visible_now' else None
            if stage=='visible_now' and geometry is None: candidate=None
            else:
                key=(loc.id,stage=='visible_now')
                if key not in weather:weather[key]=forecast(float(loc.latitude),float(loc.longitude),max_age_seconds=900 if stage=='visible_now' else 3600)
                candidate=opportunity_candidate(row,loc,pref,now,stage,weather[key],geometry)
            if candidate:generated+=persist(engine,token,row.owner_id,row.subscription_id,loc.id,candidate,now)
            elif stage=='visible_now':
                with Session(engine) as db:
                    fence(db,token);current=db.get(ViewingOpportunity,identity);setattr(current,state,'suppressed');db.commit()
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
                plan_due=not state.last_planned_at or now-utc(state.last_planned_at)>=timedelta(minutes=5)
                def batch(after):return list(db.scalars(select(NotificationPreferences.owner_id).where(NotificationPreferences.notifications_enabled.is_(True),NotificationPreferences.owner_id>after).order_by(NotificationPreferences.owner_id).limit(MAX_USERS)))
                owners=(batch(cursor) or batch(0)) if plan_due else []
                db.execute(delete(ViewingOpportunity).where(ViewingOpportunity.end_at<now-timedelta(days=2)))
                db.execute(update(ViewingOpportunity).where(ViewingOpportunity.status=='scheduled',ViewingOpportunity.end_at<=now).values(status='ended',
                    advance_state=case((ViewingOpportunity.advance_state=='pending','missed'),else_=ViewingOpportunity.advance_state),visible_state=case((ViewingOpportunity.visible_state=='pending','missed'),else_=ViewingOpportunity.visible_state)))
                db.execute(delete(VisibilityPlan).where(VisibilityPlan.expires_at<now));db.commit()
            generated+=dispatch_opportunities(engine,token,min(deadline-8,time.monotonic()+15))
            provider_requests=os.getenv('ORBITWATCH_NOTIFICATION_PROVIDER_REQUESTS','false').lower()=='true'
            with Session(engine) as db:
                event_needed=bool(owners and db.scalar(select(AlertSubscription.id).join(NotificationPreferences,NotificationPreferences.owner_id==AlertSubscription.owner_id).where(AlertSubscription.owner_id.in_(owners),AlertSubscription.kind=='event',NotificationPreferences.natural_event_alerts.is_(True)).limit(1)))
            events=current_events(schedule=provider_requests,refresh_providers=('eonet','gdacs','usgs'))['events'] if event_needed else []
            for owner in owners:
                if time.monotonic()>=deadline-8:break
                generated+=evaluate_owner(engine,token,owner,now,deadline-8,events);evaluated+=1;cursor=owner
            generated+=dispatch_opportunities(engine,token,deadline-5)
            process_outbox(engine,token,deadline)
            with Session(engine) as db:
                state=fence(db,token);state.cursor_owner=cursor;state.last_success_at=now_utc();state.lease_until=None;state.token=None
                state.evaluated=evaluated;state.generated=generated;state.last_error=None
                if plan_due:state.last_planned_at=now
                db.commit()
            return {'state':'completed','evaluated':evaluated,'generated':generated}
        except BaseException as error:
            try:
                with Session(engine) as db:
                    state=fence(db,token);state.last_error='interrupted' if isinstance(error,(KeyboardInterrupt,SystemExit)) else 'run_failed';state.lease_until=None;state.token=None;db.commit()
            except Exception:pass  # Durable lease expires after process/DB failure.
            raise
