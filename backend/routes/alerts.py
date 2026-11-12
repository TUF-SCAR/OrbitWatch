import base64
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import json
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from core.database import get_database_session
from core.security import get_current_user
from models.user import User
from models.alerts import AlertSubscription, InboxNotification
from models.notification_delivery import NotificationDelivery
from routes.account import account_storage, lock_owner
from schemas.alerts import SubscriptionInput, SubscriptionResponse, InboxItem
from services.account_targets import LIMITS, target_name
from services.account_inbox import RETENTION_DAYS, utc

router = APIRouter(prefix="/api/account", tags=["Account alerts"])


@contextmanager
def storage(database, response, model):
    response.headers["Cache-Control"] = "no-store"
    with account_storage(database):
        database.execute(select(model.id).limit(0))
        yield


@router.get("/alert-subscriptions", response_model=list[SubscriptionResponse])
def subscriptions(response: Response, user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    with storage(database, response, AlertSubscription):
        return list(database.scalars(select(AlertSubscription).where(AlertSubscription.owner_id == user.id).order_by(AlertSubscription.kind, AlertSubscription.created_at)))


@router.post("/alert-subscriptions", response_model=SubscriptionResponse, status_code=201)
def follow(body: SubscriptionInput, response: Response, user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    with storage(database, response, AlertSubscription):
        lock_owner(database, user.id)
        rows = list(database.scalars(select(AlertSubscription).where(AlertSubscription.owner_id == user.id, AlertSubscription.kind == body.kind)))
        existing = next((row for row in rows if row.target_id == body.target_id), None)
        if existing:
            response.status_code = 200
            return existing
        if len(rows) >= LIMITS[body.kind]:
            raise HTTPException(409, f"Follow limit reached ({LIMITS[body.kind]})")
        row = AlertSubscription(owner_id=user.id, kind=body.kind, target_id=body.target_id,
            target_name=target_name(body.kind, body.target_id)[:120], slot=next(i for i in range(1, LIMITS[body.kind]+1) if all(r.slot != i for r in rows)))
        database.add(row); database.commit(); database.refresh(row)
        return row


@router.delete("/alert-subscriptions/{identity}", status_code=204)
def unfollow(identity: UUID, response: Response, user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    with storage(database, response, AlertSubscription):
        lock_owner(database, user.id)
        database.execute(delete(AlertSubscription).where(AlertSubscription.id == str(identity), AlertSubscription.owner_id == user.id))
        database.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


def visible(user_id, now):
    return (InboxNotification.owner_id == user_id, InboxNotification.dismissed_at.is_(None), InboxNotification.created_at >= now - timedelta(days=RETENTION_DAYS))


def unread(database, user_id, now):
    return database.scalar(select(func.count()).select_from(InboxNotification).where(*visible(user_id, now), InboxNotification.read_at.is_(None)))


@router.get("/notifications/unread-count")
def unread_count(response: Response, user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    with storage(database, response, InboxNotification):
        return {"unread_count": unread(database, user.id, datetime.now(timezone.utc))}


@router.get("/notifications")
def inbox(response: Response, limit: int = Query(20, ge=1, le=50), cursor: str | None = Query(None, max_length=200), user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    with storage(database, response, InboxNotification):
        now = datetime.now(timezone.utc)
        query = select(InboxNotification).where(*visible(user.id, now))
        if cursor:
            try:
                stamp, identity = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
                stamp = datetime.fromisoformat(stamp); identity = str(UUID(identity))
                if stamp.tzinfo is None:
                    raise ValueError()
            except (ValueError, TypeError, UnicodeError, json.JSONDecodeError):
                raise HTTPException(422, "Invalid inbox cursor") from None
            query = query.where(or_(InboxNotification.created_at < stamp, and_(InboxNotification.created_at == stamp, InboxNotification.id < identity)))
        rows = list(database.scalars(query.order_by(InboxNotification.created_at.desc(), InboxNotification.id.desc()).limit(limit+1)))
        more = len(rows) > limit; rows = rows[:limit]
        metadata={}
        try:
            with database.begin_nested():
                metadata={item.inbox_id:item for item in database.scalars(select(NotificationDelivery).where(NotificationDelivery.owner_id==user.id,NotificationDelivery.inbox_id.in_([row.id for row in rows])))}
        except SQLAlchemyError:
            pass  # A missing additive delivery migration does not break the old inbox.
        items = [InboxItem(**{key: utc(getattr(row,key)) if key.endswith('_at') else getattr(row,key) for key in InboxItem.model_fields if key not in {"is_expired","destination","source_url","delivery_state","alert_stage","opportunity_id","viewing_details"}},
            source_url=metadata[row.id].source_url if row.id in metadata else None,delivery_state=metadata[row.id].state if row.id in metadata else None,
            alert_stage=metadata[row.id].alert_stage if row.id in metadata else None,opportunity_id=metadata[row.id].opportunity_id if row.id in metadata else None,
            viewing_details=metadata[row.id].details if row.id in metadata and row.kind!='event' and metadata[row.id].details else None,
            is_expired=bool(row.expires_at and utc(row.expires_at) <= now), destination={"kind": row.kind, "target_id": row.target_id}).model_dump() for row in rows]
        next_cursor = base64.urlsafe_b64encode(json.dumps([utc(rows[-1].created_at).isoformat(), rows[-1].id]).encode()).decode().rstrip("=") if more else None
        return {"items": items, "next_cursor": next_cursor, "unread_count": unread(database,user.id,now), "retention_days": RETENTION_DAYS}


@router.post("/notifications/read-all")
def read_all(response: Response, user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    with storage(database, response, InboxNotification):
        now=datetime.now(timezone.utc)
        database.execute(update(InboxNotification).where(*visible(user.id,now), InboxNotification.read_at.is_(None)).values(read_at=now)); database.commit()
        return {"read_at": now, "unread_count": unread(database,user.id,now)}


@router.get('/notifications/{identity}')
def notification_detail(identity:UUID,response:Response,user:User=Depends(get_current_user),database:Session=Depends(get_database_session)):
    """A push deep link must never rely on the first inbox page or another owner."""
    with storage(database,response,InboxNotification):
        now=datetime.now(timezone.utc)
        row=database.scalar(select(InboxNotification).where(*visible(user.id,now),InboxNotification.id==str(identity)))
        if not row:raise HTTPException(404,'Notification no longer available')
        metadata=database.scalar(select(NotificationDelivery).where(NotificationDelivery.owner_id==user.id,NotificationDelivery.inbox_id==row.id))
        return {'id':row.id,'title':row.title,'message':row.message,'kind':row.kind,'target_id':row.target_id,'read_at':utc(row.read_at),
                'is_expired':bool(row.expires_at and utc(row.expires_at)<=now),'destination':{'kind':row.kind,'target_id':row.target_id},
                'viewing_details':metadata.details if metadata and row.kind!='event' else None,'alert_stage':metadata.alert_stage if metadata else None}


@router.put("/notifications/{identity}/read")
def read_one(identity: UUID, response: Response, user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    with storage(database, response, InboxNotification):
        row=database.scalar(select(InboxNotification).where(InboxNotification.id==str(identity), InboxNotification.owner_id==user.id))
        if not row:
            raise HTTPException(404,"Notification no longer available")
        if row.read_at is None:
            row.read_at=datetime.now(timezone.utc); database.commit()
        return {"read_at": utc(row.read_at), "unread_count": unread(database,user.id,datetime.now(timezone.utc))}


@router.delete("/notifications/{identity}")
def dismiss(identity: UUID, response: Response, user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    with storage(database,response,InboxNotification):
        database.execute(update(InboxNotification).where(InboxNotification.id==str(identity),InboxNotification.owner_id==user.id,InboxNotification.dismissed_at.is_(None)).values(dismissed_at=datetime.now(timezone.utc))); database.commit()
        return {"unread_count": unread(database,user.id,datetime.now(timezone.utc))}
