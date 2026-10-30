from datetime import datetime
from datetime import date
from sqlalchemy import Date, DateTime, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column
from core.database import DatabaseBase


class HistoricalElements(DatabaseBase):
    __tablename__ = 'satellite_historical_elements'
    __table_args__ = (Index('ix_historical_norad_epoch', 'norad_id', 'epoch'),)

    record_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    norad_id: Mapped[int] = mapped_column(Integer, nullable=False)
    epoch: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    object_name: Mapped[str] = mapped_column(String(255), nullable=False)
    object_id: Mapped[str] = mapped_column(String(50), nullable=False)
    launch_date: Mapped[date | None] = mapped_column(Date)
    decay_date: Mapped[date | None] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    source_record_id: Mapped[str | None] = mapped_column(String(80))
    element_format: Mapped[str] = mapped_column(String(4), nullable=False)
    elements: Mapped[dict] = mapped_column(JSON, nullable=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
