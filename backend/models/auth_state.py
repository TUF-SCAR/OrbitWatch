from sqlalchemy import BigInteger, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from core.database import DatabaseBase


class RevokedSession(DatabaseBase):
    __tablename__ = "account_revoked_sessions"

    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[int] = mapped_column(BigInteger, index=True)


class AuthAttempt(DatabaseBase):
    __tablename__ = "account_auth_attempts"

    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    count: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int] = mapped_column(BigInteger, index=True)
