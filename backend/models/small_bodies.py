from sqlalchemy import String, Float, Integer, JSON, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column
from core.database import DatabaseBase


class SmallBodyOrbit(DatabaseBase):
    __tablename__='small_body_orbits'
    body_id: Mapped[str]=mapped_column(String(24),primary_key=True)
    designation: Mapped[str]=mapped_column(String(12),unique=True)
    spk_id: Mapped[str]=mapped_column(String(12),unique=True)
    solution_id: Mapped[str]=mapped_column(String(80))
    # Validated compact elements/provenance only, never the raw SBDB response.
    elements: Mapped[dict]=mapped_column(JSON)
    retrieved_at: Mapped[float]=mapped_column(Float)
    checked_at: Mapped[float]=mapped_column(Float)


class SmallBodyRefresh(DatabaseBase):
    __tablename__='small_body_refresh_state'
    __table_args__=(CheckConstraint('id=1'),)
    id: Mapped[int]=mapped_column(Integer,primary_key=True)
    lease_token: Mapped[str | None]=mapped_column(String(36),nullable=True)
    lease_until: Mapped[float]=mapped_column(Float,default=0)
    next_at: Mapped[float]=mapped_column(Float,default=0)
    failures: Mapped[int]=mapped_column(Integer,default=0)
    day_start: Mapped[float]=mapped_column(Float,default=0)
    day_calls: Mapped[int]=mapped_column(Integer,default=0)
    object_errors: Mapped[dict]=mapped_column(JSON,default=dict)

