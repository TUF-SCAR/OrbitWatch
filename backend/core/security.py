from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session
from core.database import get_database_session
from models.user import User
from services.auth import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 50


def check_username_char(username: str) -> bool:
    """Validate the complete username; preserve Unicode letters and digits."""
    if not isinstance(username, str) or not USERNAME_MIN_LENGTH <= len(username) <= USERNAME_MAX_LENGTH:
        return False
    if username.startswith(".") or username.endswith(".") or ".." in username:
        return False
    return all(char.isalpha() or char.isdecimal() or char in "._" for char in username)


def check_email(email: str) -> bool:
    """Deterministic app-level validation of ordinary, unquoted email addresses."""
    if not isinstance(email, str) or not email.isascii() or len(email) > 254 or email.count("@") != 1:
        return False
    local, domain = email.split("@")
    if not 1 <= len(local) <= 64 or local.startswith(".") or local.endswith(".") or ".." in local:
        return False
    allowed_local = ".!#$%&'*+-/=?^_`{|}~"
    if not all(char.isalnum() or char in allowed_local for char in local):
        return False
    if not domain or len(domain) > 253:
        return False
    labels = domain.split(".")
    if len(labels) < 2 or not 2 <= len(labels[-1]) <= 63 or not labels[-1].isalpha():
        return False
    for label in labels:
        if not 1 <= len(label) <= 63 or label.startswith("-") or label.endswith("-"):
            return False
        if not all(char.isalnum() or char == "-" for char in label):
            return False
    return True


def get_token_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> int:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        user_id = decode_access_token(credentials.credentials)
    except RuntimeError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return user_id


def get_current_user(
    user_id: int = Depends(get_token_user_id),
    database: Session = Depends(get_database_session),
) -> User:

    query = select(User).where(User.id == user_id)

    database_user = database.scalar(query)

    if database_user is None:
        raise HTTPException(status_code=401, detail="User no longer exists")

    return database_user
