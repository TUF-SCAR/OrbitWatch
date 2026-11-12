"""Compact private delivery metadata; migrations are explicit, never startup DDL."""
from datetime import datetime
from uuid import uuid4
from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column
from core.database import DatabaseBase


class PushDevice(DatabaseBase):
    __tablename__='account_push_devices'
    __table_args__=(UniqueConstraint('endpoint_hash',name='uq_push_endpoint'),UniqueConstraint('owner_id','slot',name='uq_push_slot'),
                   CheckConstraint('slot BETWEEN 1 AND 5 AND length(endpoint_hash)=64',name='ck_push_bounds'),)
    id:Mapped[str]=mapped_column(Uuid(as_uuid=False),primary_key=True,default=lambda:str(uuid4()))
    owner_id:Mapped[int]=mapped_column(ForeignKey('users.id',ondelete='CASCADE'),nullable=False)
    slot:Mapped[int]=mapped_column(Integer,nullable=False)
    endpoint_hash:Mapped[str]=mapped_column(String(64),nullable=False)
    encrypted_subscription:Mapped[str]=mapped_column(Text,nullable=False)
    created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),server_default=func.now(),nullable=False)


class NotificationRun(DatabaseBase):
    __tablename__='notification_runner_state'
    __table_args__=(CheckConstraint('id=1 AND cursor_owner>=0',name='ck_notification_runner_singleton'),)
    id:Mapped[int]=mapped_column(Integer,primary_key=True)
    token:Mapped[str|None]=mapped_column(String(36))
    lease_until:Mapped[datetime|None]=mapped_column(DateTime(timezone=True))
    started_at:Mapped[datetime|None]=mapped_column(DateTime(timezone=True))
    last_success_at:Mapped[datetime|None]=mapped_column(DateTime(timezone=True))
    last_error:Mapped[str|None]=mapped_column(String(40))
    mode:Mapped[str|None]=mapped_column(String(16))
    cursor_owner:Mapped[int]=mapped_column(Integer,nullable=False,default=0,server_default='0')
    evaluated:Mapped[int]=mapped_column(Integer,nullable=False,default=0,server_default='0')
    generated:Mapped[int]=mapped_column(Integer,nullable=False,default=0,server_default='0')
    last_planned_at:Mapped[datetime|None]=mapped_column(DateTime(timezone=True))


class NotificationDelivery(DatabaseBase):
    __tablename__='account_notification_delivery'
    __table_args__=(UniqueConstraint('owner_id','dedup_key',name='uq_delivery_dedup'),
        CheckConstraint("kind IN ('satellite','celestial','event') AND length(dedup_key)=64",name='ck_delivery_identity'),
        Index('ix_delivery_owner_expiry','owner_id','expires_at'),Index('ix_delivery_pending','state','next_attempt_at'),)
    id:Mapped[str]=mapped_column(Uuid(as_uuid=False),primary_key=True,default=lambda:str(uuid4()))
    owner_id:Mapped[int]=mapped_column(ForeignKey('users.id',ondelete='CASCADE'),nullable=False)
    dedup_key:Mapped[str]=mapped_column(String(64),nullable=False)
    kind:Mapped[str]=mapped_column(String(12),nullable=False)
    target_id:Mapped[str]=mapped_column(String(120),nullable=False)
    category:Mapped[str]=mapped_column(String(32),nullable=False)
    subscription_id:Mapped[str|None]=mapped_column(Uuid(as_uuid=False),ForeignKey('account_alert_subscriptions.id',ondelete='SET NULL'))
    location_id:Mapped[str|None]=mapped_column(Uuid(as_uuid=False),ForeignKey('account_observation_locations.id',ondelete='SET NULL'))
    inbox_id:Mapped[str|None]=mapped_column(Uuid(as_uuid=False),ForeignKey('account_notification_inbox.id',ondelete='SET NULL'))
    latitude:Mapped[float]=mapped_column(Float,nullable=False)
    longitude:Mapped[float]=mapped_column(Float,nullable=False)
    opportunity_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),nullable=False)
    source_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),nullable=False)
    source_url:Mapped[str|None]=mapped_column(String(1500))
    severity:Mapped[float|None]=mapped_column(Float)
    expires_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),nullable=False)
    created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),server_default=func.now(),nullable=False)
    state:Mapped[str]=mapped_column(String(24),nullable=False,default='inbox_persisted')
    devices:Mapped[list]=mapped_column(JSON,nullable=False,default=list)
    next_attempt_at:Mapped[datetime|None]=mapped_column(DateTime(timezone=True))
    alert_stage:Mapped[str]=mapped_column(String(16),nullable=False,default='advance',server_default='advance')
    opportunity_id:Mapped[str|None]=mapped_column(Uuid(as_uuid=False))
    details:Mapped[dict]=mapped_column(JSON,nullable=False,default=dict)
