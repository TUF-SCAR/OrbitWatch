import jwt
from core.config import required
from pwdlib import PasswordHash
from datetime import datetime, timedelta, timezone
from uuid import uuid4

password_hash = PasswordHash.recommended()
JWT_SECRET_KEY = required("JWT_SECRET_KEY")


def hash_password(password: str) -> str:
    hashed_password = password_hash.hash(password=password)
    return hashed_password


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password=password, hash=hashed_password)


def create_access_token(user_id: int) -> str:
    issued = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "exp": issued + timedelta(hours=24), "iat": issued, "jti": uuid4().hex}

    return jwt.encode(payload=payload, key=JWT_SECRET_KEY, algorithm="HS256")


def access_claims(token: str) -> tuple[int, int]:
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"], options={"require": ["sub", "exp"]})
        subject, expiry = payload["sub"], payload["exp"]
        if (not isinstance(subject, str) or not subject.isascii() or not subject.isdecimal() or len(subject) > 10
                or not 0 < int(subject) <= 2_147_483_647 or type(expiry) is not int):
            raise ValueError("Invalid JWT claims")
        issued = payload.get("iat")
        if issued is not None and (type(issued) is not int or not 0 < expiry - issued <= 86400):
            raise ValueError("Invalid session lifetime")
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise RuntimeError("Invalid or expired token") from None

    return int(subject), expiry


def decode_access_token(token: str) -> int:
    return access_claims(token)[0]
