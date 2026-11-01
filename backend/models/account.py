"""Account foundation only: no subscriptions, scheduler or delivery records."""
from datetime import datetime, time
from decimal import Decimal
from uuid import uuid4
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger, String, Time, UniqueConstraint, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column
from core.database import DatabaseBase


class ObservationLocation(DatabaseBase):
    __tablename__ = "account_observation_locations"
    __table_args__ = (
        CheckConstraint("slot BETWEEN 1 AND 5", name="ck_account_location_slot"),
        CheckConstraint("latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180", name="ck_account_location_coordinates"),
        CheckConstraint("length(name) BETWEEN 1 AND 80 AND length(timezone) BETWEEN 1 AND 64", name="ck_account_location_text"),
        CheckConstraint("version > 0", name="ck_account_location_version"),
        UniqueConstraint("owner_id", "slot", name="uq_account_location_slot"),
        UniqueConstraint("owner_id", "latitude", "longitude", name="uq_account_location_coordinates"),
        Index("uq_account_location_default", "owner_id", unique=True, postgresql_where=text("is_default"), sqlite_where=text("is_default = 1")),
    )
    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    slot: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    latitude: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    longitude: Mapped[Decimal] = mapped_column(Numeric(10, 6), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class NotificationPreferences(DatabaseBase):
    __tablename__ = "account_notification_preferences"
    __table_args__ = (
        CheckConstraint("advance_warning_minutes IN (10, 30, 60)", name="ck_account_warning"),
        CheckConstraint("event_radius_km BETWEEN 1 AND 2000", name="ck_account_radius"),
        CheckConstraint("quiet_timezone_mode IN ('default_location', 'explicit')", name="ck_account_quiet_source"),
        CheckConstraint("NOT quiet_hours_enabled OR quiet_timezone_mode <> 'explicit' OR (quiet_timezone IS NOT NULL AND length(quiet_timezone) BETWEEN 1 AND 64)", name="ck_account_quiet_timezone"),
        CheckConstraint("NOT quiet_hours_enabled OR (quiet_start IS NOT NULL AND quiet_end IS NOT NULL AND quiet_start <> quiet_end)", name="ck_account_quiet_hours"),
        CheckConstraint("version > 0", name="ck_account_preferences_version"),
    )
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    satellite_alerts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    celestial_alerts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    natural_event_alerts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    advance_warning_minutes: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=30, server_default=text("30"))
    event_radius_km: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=100, server_default=text("100"))
    quiet_hours_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    quiet_start: Mapped[time | None] = mapped_column(Time)
    quiet_end: Mapped[time | None] = mapped_column(Time)
    quiet_timezone_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="default_location", server_default=text("'default_location'"))
    quiet_timezone: Mapped[str | None] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
