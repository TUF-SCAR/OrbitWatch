"""Bounded trusted storage helper for a FUTURE producer. No scheduler/network."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from sqlalchemy import delete, select
from models.account import ObservationLocation
from models.alerts import InboxNotification
from models.user import User
from schemas.alerts import TrustedNotificationInput

RETENTION_DAYS = 30
MAX_INBOX_ITEMS = 200


def utc(value):
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def store_notification(database, owner_id: int, payload: TrustedNotificationInput):
    """Caller owns commit. Only trusted producers may call this; never seed prod."""
    payload = TrustedNotificationInput.model_validate(payload.model_dump() if isinstance(payload,TrustedNotificationInput) else payload)
    if not database.scalar(select(User).where(User.id == owner_id).with_for_update()):
        raise ValueError("Recipient no longer exists")
    now = datetime.now(timezone.utc)
    database.execute(delete(InboxNotification).where(InboxNotification.owner_id == owner_id, InboxNotification.created_at < now - timedelta(days=RETENTION_DAYS)))
    digest = sha256(payload.dedup_key.encode()).hexdigest()
    existing = database.scalar(select(InboxNotification).where(InboxNotification.owner_id == owner_id, InboxNotification.dedup_key == digest))
    if existing:
        return existing
    location = None
    if payload.location_id:
        location = database.scalar(select(ObservationLocation).where(ObservationLocation.id == str(payload.location_id), ObservationLocation.owner_id == owner_id))
        if not location:
            raise ValueError("Observation location does not belong to recipient")
    rows = list(database.scalars(select(InboxNotification).where(InboxNotification.owner_id == owner_id).order_by(InboxNotification.created_at, InboxNotification.id)))
    if len(rows) >= MAX_INBOX_ITEMS:
        database.delete(rows.pop(0)); database.flush()
    used = {row.slot for row in rows}
    row = InboxNotification(owner_id=owner_id, slot=next(i for i in range(1, 201) if i not in used),
        **payload.model_dump(exclude={"location_id", "dedup_key"}), location_id=str(payload.location_id) if location else None,
        location_name=location.name if location else None, dedup_key=digest, created_at=now)
    database.add(row); database.flush()
    return row
