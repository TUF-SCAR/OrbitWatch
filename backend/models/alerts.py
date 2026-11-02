from datetime import datetime
from uuid import uuid4
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, SmallInteger, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column
from core.database import DatabaseBase
from services.account_targets import target_constraint


class AlertSubscription(DatabaseBase):
    __tablename__ = "account_alert_subscriptions"
    __table_args__ = (
        CheckConstraint(target_constraint(), name="ck_account_subscription_target"),
        CheckConstraint("(kind='satellite' AND slot BETWEEN 1 AND 20) OR (kind='celestial' AND slot BETWEEN 1 AND 8) OR (kind='event' AND slot BETWEEN 1 AND 13)", name="ck_account_subscription_slot"),
        UniqueConstraint("owner_id", "kind", "target_id", name="uq_account_subscription_target"),
        UniqueConstraint("owner_id", "kind", "slot", name="uq_account_subscription_slot"),
    )
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    target_id: Mapped[str] = mapped_column(String(64), nullable=False)
    target_name: Mapped[str] = mapped_column(String(120), nullable=False)
    slot: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class InboxNotification(DatabaseBase):
    __tablename__ = "account_notification_inbox"
    __table_args__ = (
        CheckConstraint("kind IN ('satellite','celestial','event') AND length(target_id) BETWEEN 1 AND 120", name="ck_account_inbox_target"),
        CheckConstraint("length(title) BETWEEN 1 AND 120 AND length(message) BETWEEN 1 AND 400", name="ck_account_inbox_text"),
        CheckConstraint("length(dedup_key)=64 AND slot BETWEEN 1 AND 200", name="ck_account_inbox_bounds"),
        UniqueConstraint("owner_id", "dedup_key", name="uq_account_inbox_dedup"),
        UniqueConstraint("owner_id", "slot", name="uq_account_inbox_slot"),
        Index("ix_account_inbox_recent", "owner_id", "created_at", "id"),
    )
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    slot: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    target_id: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    message: Mapped[str] = mapped_column(String(400), nullable=False)
    location_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), ForeignKey("account_observation_locations.id", ondelete="SET NULL"))
    location_name: Mapped[str | None] = mapped_column(String(80))
    source_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dedup_key: Mapped[str] = mapped_column(String(64), nullable=False)
