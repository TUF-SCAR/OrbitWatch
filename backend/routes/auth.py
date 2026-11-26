from functools import lru_cache
from unicodedata import normalize
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from models.user import User
from models.notification_delivery import PushDevice
from core.database import get_database_session
from core.security import bearer_scheme, check_username_char, check_email, get_current_user, USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH
from schemas.auth import RegisterRequest, LoginRequest, AuthResponse, UserResponse
from services.auth import access_claims, hash_password, verify_password, create_access_token
from services.auth_state import consume_attempt, revoke_session

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def normalized_email(value):
    local, _, domain = value.strip().partition("@")
    return f'{local}@{domain.lower()}'


def email_match(value):
    local, domain = value.split("@", 1)
    size = len(local) + 1
    return (func.substr(User.email, 1, size) == local + "@") & (func.lower(func.substr(User.email, size + 1)) == domain)


def username_match(database, value):
    column = func.normalize(User.username) if database.get_bind().dialect.name == "postgresql" else User.username
    return column == value


@lru_cache(maxsize=1)
def absent_user_hash():
    return hash_password("OrbitWatch authentication timing placeholder")


@router.post("/register", status_code=201)
def Registration(
    user: RegisterRequest, request: Request, response: Response, database: Session = Depends(get_database_session)
) -> AuthResponse:
    response.headers["Cache-Control"] = "no-store"
    consume_attempt(database, "register", request.client.host if request.client else "unknown", 10, 3600)
    username = normalize("NFC", user.username.strip())
    email = normalized_email(user.email)
    password = user.password

    if len(username) < USERNAME_MIN_LENGTH or len(username) > USERNAME_MAX_LENGTH:
        raise HTTPException(
            status_code=400,
            detail="Invalid username length",
        )

    if not check_username_char(username=username):
        raise HTTPException(
            status_code=400,
            detail="Invalid username characters",
        )

    username_query = select(User).where(username_match(database, username))
    username_exists = database.scalar(username_query)

    if username_exists:
        raise HTTPException(
            status_code=409,
            detail="Username already exists",
        )

    if not check_email(email=email):
        raise HTTPException(
            status_code=400,
            detail="Invalid email format",
        )

    email_query = select(User).where(email_match(email))
    email_exists = database.scalar(email_query)

    if email_exists:
        raise HTTPException(
            status_code=409,
            detail="Email already exists",
        )

    if len(password) < 15 or not password.strip():
        raise HTTPException(
            status_code=400,
            detail="Use at least 15 characters for your password",
        )

    hashed_password = hash_password(password=password)

    new_user = User(
        username=username,
        email=email,
        password_hash=hashed_password,
    )

    database.add(new_user)
    try:
        database.commit()
    except IntegrityError:
        database.rollback()
        raise HTTPException(status_code=409, detail="Username or email already exists") from None
    database.refresh(new_user)

    access_token = create_access_token(new_user.id)

    return AuthResponse(
        access_token=access_token,
        token_type="bearer",
    )


@router.post("/login")
def Login(
    user: LoginRequest, request: Request, response: Response, database: Session = Depends(get_database_session)
) -> AuthResponse:
    response.headers["Cache-Control"] = "no-store"
    consume_attempt(database, "login", request.client.host if request.client else "unknown", 20, 300)
    username_or_email = normalize("NFC", user.username_or_email.strip())
    password = user.password

    if "@" in username_or_email:
        username_or_email = normalized_email(username_or_email)
        if not check_email(email=username_or_email):
            raise HTTPException(
                status_code=400,
                detail="Invalid email format",
            )

    else:
        if len(username_or_email) < USERNAME_MIN_LENGTH or len(username_or_email) > USERNAME_MAX_LENGTH:
            raise HTTPException(
                status_code=400,
                detail="Invalid username length",
            )

        if not check_username_char(username=username_or_email):
            raise HTTPException(
                status_code=400,
                detail="Invalid username characters",
            )

    condition = email_match(username_or_email) if "@" in username_or_email else username_match(database, username_or_email)
    query = select(User).where(condition)
    database_user = database.scalar(query)

    password_correct = verify_password(
        password=password, hashed_password=database_user.password_hash if database_user else absent_user_hash()
    )

    if database_user is None or not password_correct:
        raise HTTPException(
            status_code=401,
            detail="Invalid username/email or password",
        )

    access_token = create_access_token(database_user.id)

    return AuthResponse(
        access_token=access_token,
        token_type="bearer",
    )


@router.get("/me", response_model=UserResponse)
def Me(response: Response, current_user: User = Depends(get_current_user)) -> User:
    response.headers["Cache-Control"] = "no-store"
    return current_user


class LogoutRequest(BaseModel):
    device_id: UUID | None = None


@router.post("/logout", status_code=204)
def logout(
    body: LogoutRequest,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    current_user: User = Depends(get_current_user),
    database: Session = Depends(get_database_session),
):
    token = credentials.credentials
    _, expires_at = access_claims(token)
    revoke_session(database, token, expires_at)
    if body.device_id:
        database.execute(delete(PushDevice).where(
            PushDevice.owner_id == current_user.id, PushDevice.id == str(body.device_id)))
    database.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
