import jwt
from os import getenv
from pathlib import Path
from dotenv import load_dotenv
from pwdlib import PasswordHash
from datetime import datetime, timedelta, timezone

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    hashed_password = password_hash.hash(password=password)
    return hashed_password


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password=password, hash=hashed_password)


def create_access_token(user_id: int) -> str:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        raise FileNotFoundError(f".env file not found at: {env_path}")

    load_dotenv(dotenv_path=env_path, override=True)

    JWT_SECRET_KEY = getenv("JWT_SECRET_KEY")
    if not JWT_SECRET_KEY or not JWT_SECRET_KEY.strip():
        raise RuntimeError("JWT_SECRET_KEY is missing or empty in backend/.env")

    expire_time = datetime.now(timezone.utc) + timedelta(hours=24)
    payload = {"sub": str(user_id), "exp": expire_time}

    return jwt.encode(payload=payload, key=JWT_SECRET_KEY, algorithm="HS256")


def decode_access_token(token: str) -> int:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        raise FileNotFoundError(f".env file not found at: {env_path}")

    load_dotenv(dotenv_path=env_path, override=True)

    JWT_SECRET_KEY = getenv("JWT_SECRET_KEY")
    if not JWT_SECRET_KEY or not JWT_SECRET_KEY.strip():
        raise RuntimeError("JWT_SECRET_KEY is missing or empty in backend/.env")

    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
        if "sub" not in payload:
            raise RuntimeError("Token has no user ID")
        user_id = int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise RuntimeError("Token is Expired")
    except jwt.InvalidTokenError:
        raise RuntimeError("Token is Invalid")

    return user_id


if __name__ == "__main__":
    a = 106
    token = create_access_token(a)

    print(token)

    b = decode_access_token(token)

    print(b)
