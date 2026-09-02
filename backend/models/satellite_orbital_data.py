from datetime import datetime
from sqlalchemy import DateTime, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from core.database import DatabaseBase


class SatelliteOrbitalData(DatabaseBase):
    __tablename__ = "satellite_orbit_data"

    norad_id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    object_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    object_id: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )

    epoch: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    tle_line1: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    tle_line2: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    source: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    raw_data: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )


class SatelliteOrbitalDataHistory(DatabaseBase):
    __tablename__ = "satellite_orbit_history"

    norad_id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    object_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    object_id: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )

    epoch: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    tle_line1: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    tle_line2: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    source: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    raw_data: Mapped[dict | None] = mapped_column(
        JSON,
        nullable=True,
    )
