from hashlib import sha256
from hmac import digest
import time

from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from models.auth_state import AuthAttempt, RevokedSession
from services.auth import JWT_SECRET_KEY


def token_digest(token):
    return sha256(token.encode()).hexdigest()


def insert_state(database, model):
    insert = sqlite_insert if database.get_bind().dialect.name == 'sqlite' else pg_insert
    return insert(model)


def consume_attempt(database, scope, identity, limit, seconds):
    now = int(time.time())
    expiry = (now // seconds + 1) * seconds
    key = digest(JWT_SECRET_KEY.encode(), f'{scope}:{expiry}:{identity}'.encode(), 'sha256').hex()
    database.execute(delete(AuthAttempt).where(AuthAttempt.expires_at <= now))
    statement = insert_state(database, AuthAttempt).values(digest=key, count=1, expires_at=expiry)
    count = database.scalar(statement.on_conflict_do_update(
        index_elements=[AuthAttempt.digest], set_={'count': AuthAttempt.count + 1},
        where=AuthAttempt.count < limit).returning(AuthAttempt.count))
    database.commit()
    if count is None:
        raise HTTPException(429, 'Too many attempts. Try again shortly.',
                            headers={'Retry-After': str(expiry - now), 'Cache-Control': 'no-store'})


def revoke_session(database, token, expiry):
    database.execute(delete(RevokedSession).where(RevokedSession.expires_at <= int(time.time())))
    database.execute(insert_state(database, RevokedSession).values(
        digest=token_digest(token), expires_at=expiry).on_conflict_do_nothing())
