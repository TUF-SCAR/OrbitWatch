import jwt
from core.config import required
from pwdlib import PasswordHash
from datetime import datetime, timedelta, timezone

password_hash = PasswordHash.recommended()
JWT_SECRET_KEY = required("JWT_SECRET_KEY")


def hash_password(password: str) -> str:
    hashed_password = password_hash.hash(password=password)
    return hashed_password


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password=password, hash=hashed_password)


def create_access_token(user_id: int) -> str:
    expire_time = datetime.now(timezone.utc) + timedelta(hours=24)
    payload = {"sub": str(user_id), "exp": expire_time}

    return jwt.encode(payload=payload, key=JWT_SECRET_KEY, algorithm="HS256")


def decode_access_token(token: str) -> int:
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"], options={"require": ["sub", "exp"]})
        if "sub" not in payload:
            raise RuntimeError("Token has no user ID")
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise RuntimeError("Invalid or expired token") from None

    return user_id
