"""Reusable bounded geometry and compact PostgreSQL opportunity scheduling."""
from datetime import datetime,timedelta
from hashlib import sha256
import json
from uuid import uuid4
from sqlalchemy import delete,func,select,update
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from models.viewing_opportunity import ViewingOpportunity,VisibilityPlan
from models.notification_delivery import NotificationDelivery
from services.account_inbox import utc
from services.visibility import prediction,stamp

MAX_OWNER_PLANS=512
MAX_ALL_PLANS=10000

def source_key(kind,target,record):
    data=f'{kind}:{target}:DE421:useful-v3-refined'
    if kind=='satellite': data+=':missing' if record is None else f':{record.norad_id}:{record.epoch}:{record.tle_line1}:{record.tle_line2}'
    return sha256(data.encode()).hexdigest()

def shared_prediction(engine,kind,target,record,location,now,hours):
    key=sha256(json.dumps([source_key(kind,target,record),float(location['latitude']),float(location['longitude']),location['timezone'],hours,int(now.timestamp())//7200],separators=(',',':')).encode()).hexdigest()
    preparing={'state':'unavailable','reason':'Shared geometry is being prepared; retry shortly','target_id':target,'computed_at':stamp(now),'windows':[]}
    token=str(uuid4());claimed=False
    try:
        with Session(engine) as db:
            row=db.get(VisibilityPlan,key)
            if row and utc(row.expires_at)>now:
                if row.result.get('_claim'):return preparing
                return {**row.result,'windows':[window for window in row.result['windows'] if utc(datetime.fromisoformat(window['end_utc']))>now]}
            from sqlalchemy.dialects.postgresql import insert as pg_insert
            from sqlalchemy.dialects.sqlite import insert as sqlite_insert
            insert=pg_insert if engine.dialect.name=='postgresql' else sqlite_insert
            db.execute(delete(VisibilityPlan).where(VisibilityPlan.expires_at<now))
            if db.scalar(select(func.count()).select_from(VisibilityPlan))>=1024:return preparing
            values={'key':key,'expires_at':now+timedelta(seconds=90),'result':{'_claim':token}}
            changed=db.execute(insert(VisibilityPlan).values(**values).on_conflict_do_update(index_elements=['key'],set_=values,where=VisibilityPlan.expires_at<=now))
            db.commit();claimed=changed.rowcount==1
            if not claimed:return preparing
    except SQLAlchemyError: pass # Additive migration missing: preview can still work.
    # Durable compare-and-swap claim prevents identical geometry CPU fanout.
    # No DB transaction/connection is held during propagation; no provider calls.
    result=prediction(kind,target,record,location,now,hours,None)
    if len(json.dumps(result))>=45000: return result
    try:
        with Session(engine) as db:
            db.execute(delete(VisibilityPlan).where(VisibilityPlan.expires_at<now))
            if claimed:
                db.execute(update(VisibilityPlan).where(VisibilityPlan.key==key,VisibilityPlan.result['_claim'].as_string()==token)
                    .values(result=result,expires_at=now+timedelta(seconds=600 if kind=='satellite' else 3600)))
            db.commit()
    except SQLAlchemyError: pass # Concurrent same-key winner is reused next call.
    return result

def schedule_result(db,owner,sub,location,pref,record,result,now):
    """Same physical segment keeps its UUID across small recomputation shifts."""
    key=source_key(sub.kind,sub.target_id,record)
    existing=list(db.scalars(select(ViewingOpportunity).where(ViewingOpportunity.owner_id==owner,ViewingOpportunity.location_id==location.id,ViewingOpportunity.subscription_id==sub.id,ViewingOpportunity.end_at>now-timedelta(hours=2))))
    matched=set();count=db.scalar(select(func.count()).select_from(ViewingOpportunity).where(ViewingOpportunity.owner_id==owner))
    total=db.scalar(select(func.count()).select_from(ViewingOpportunity))
    for window in result.get('windows',[])[:8]:
        segments=window.get('useful_segments',[]) if sub.kind=='satellite' else [window]
        for segment in segments[:4]:
            start=datetime.fromisoformat(segment['start_utc']);end=datetime.fromisoformat(segment['end_utc'])
            if end<=now or start==end: continue
            peak=datetime.fromisoformat(segment.get('maximum_at_utc',window['maximum_at_utc']))
            peak=max(start,min(end,peak))
            row=next((row for row in existing if row.status in ('scheduled','invalidated') and
                all(abs(float(row.details.get('observer',{}).get(axis,999))-float(getattr(location,axis)))<1e-7 for axis in ('latitude','longitude')) and
                abs((utc(row.start_at)-start).total_seconds())<600 and min(utc(row.end_at),end)>max(utc(row.start_at),start)),None)
            if row is None:
                # Never invent the start of a segment already clipped by the search.
                if start<=now or count>=MAX_OWNER_PLANS or total>=MAX_ALL_PLANS: continue
                identity=sha256(f'{sub.kind}:{sub.target_id}:{location.id}:{uuid4()}'.encode()).hexdigest()
                row=ViewingOpportunity(identity=identity,owner_id=owner,location_id=location.id,subscription_id=sub.id,kind=sub.kind,target_id=sub.target_id,advance_state='pending',visible_state='pending')
                count+=1;total+=1
                # Reconcile an advance produced by the prior implementation.
                legacy=db.scalar(select(NotificationDelivery).where(NotificationDelivery.owner_id==owner,NotificationDelivery.location_id==location.id,NotificationDelivery.kind==sub.kind,NotificationDelivery.target_id==sub.target_id,NotificationDelivery.opportunity_id.is_(None),NotificationDelivery.opportunity_at.between(start-timedelta(minutes=10),start+timedelta(minutes=10))))
                if legacy: row.advance_state='sent'
                db.add(row)
            row.start_at=start;row.peak_at=peak;row.end_at=end;row.advance_due_at=start-timedelta(minutes=pref.advance_warning_minutes);row.visible_due_at=start
            row.source_key=key;row.location_version=location.version;row.preference_version=pref.version;row.warning_minutes=pref.advance_warning_minutes
            row.status='scheduled';row.calculated_at=now;row.refresh_at=now+timedelta(minutes=10)
            row.details={'target_name':sub.target_name,'location_name':location.name,'observer':{'latitude':float(location.latitude),'longitude':float(location.longitude),'timezone':location.timezone},
                         'window':{**window,**segment,'start_utc':stamp(start),'end_utc':stamp(end),'maximum_at_utc':stamp(peak)},
                         'source':result.get('source'),'element_epoch':result.get('element_epoch'),'brightness':result.get('brightness'),'equipment':result.get('equipment'),
                         'moon_illumination_percent':segment.get('moon_illumination_percent',result.get('moon_illumination_percent')),'computed_at':result.get('computed_at'),
                         'rise_set':result.get('rise_set',[])}
            db.flush();matched.add(row.id)
    for row in existing:
        if row.id not in matched and (row.location_version!=location.version or row.source_key!=key or utc(row.start_at)>now): row.status='invalidated'
    return len(matched)
