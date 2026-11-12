"""Bounded private schedule and reusable compact scientific calculations."""
from datetime import datetime
from uuid import uuid4
from sqlalchemy import String,Integer,DateTime,ForeignKey,JSON,Index,UniqueConstraint,Uuid
from sqlalchemy.orm import Mapped,mapped_column
from core.database import DatabaseBase

class ViewingOpportunity(DatabaseBase):
    __tablename__='account_viewing_opportunities'
    __table_args__=(UniqueConstraint('owner_id','identity',name='uq_viewing_identity'),Index('ix_viewing_due','status','advance_due_at','visible_due_at'),Index('ix_viewing_owner_end','owner_id','end_at'))
    id:Mapped[str]=mapped_column(Uuid(as_uuid=False),primary_key=True,default=lambda:str(uuid4()))
    identity:Mapped[str]=mapped_column(String(64),nullable=False)
    owner_id:Mapped[int]=mapped_column(ForeignKey('users.id',ondelete='CASCADE'),nullable=False)
    location_id:Mapped[str]=mapped_column(Uuid(as_uuid=False),ForeignKey('account_observation_locations.id',ondelete='CASCADE'),nullable=False)
    subscription_id:Mapped[str]=mapped_column(Uuid(as_uuid=False),ForeignKey('account_alert_subscriptions.id',ondelete='CASCADE'),nullable=False)
    kind:Mapped[str]=mapped_column(String(12),nullable=False)
    target_id:Mapped[str]=mapped_column(String(64),nullable=False)
    source_key:Mapped[str]=mapped_column(String(64),nullable=False)
    location_version:Mapped[int]=mapped_column(Integer,nullable=False)
    preference_version:Mapped[int]=mapped_column(Integer,nullable=False)
    warning_minutes:Mapped[int]=mapped_column(Integer,nullable=False)
    start_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),nullable=False)
    peak_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),nullable=False)
    end_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),nullable=False)
    advance_due_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),nullable=False)
    visible_due_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),nullable=False)
    calculated_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),nullable=False)
    refresh_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),nullable=False)
    status:Mapped[str]=mapped_column(String(16),nullable=False,default='scheduled')
    advance_state:Mapped[str]=mapped_column(String(16),nullable=False,default='pending')
    visible_state:Mapped[str]=mapped_column(String(16),nullable=False,default='pending')
    details:Mapped[dict]=mapped_column(JSON,nullable=False)

class VisibilityPlan(DatabaseBase):
    __tablename__='visibility_plan_cache'
    key:Mapped[str]=mapped_column(String(64),primary_key=True)
    expires_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),nullable=False,index=True)
    result:Mapped[dict]=mapped_column(JSON,nullable=False)
