from sqlalchemy import select, or_
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends, HTTPException

from models.user import User
from core.database import get_database_session
from core.security import check_username_char, check_email, get_current_user
from schemas.auth import RegisterRequest, LoginRequest, AuthResponse, UserResponse
from services.auth import hash_password, verify_password, create_access_token

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/register", status_code=201)
def Registration(
    user: RegisterRequest, database: Session = Depends(get_database_session)
) -> AuthResponse:
    username = user.username.strip()
    email = user.email.strip()
    password = user.password.strip()

    if len(username) < 3 or len(username) > 50:
        raise HTTPException(
            status_code=400,
            detail="Invalid username length",
        )

    if not check_username_char(username=username):
        raise HTTPException(
            status_code=400,
            detail="Invalid username characters",
        )

    username_query = select(User).where(User.username == username)
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

    email_query = select(User).where(User.email == email)
    email_exists = database.scalar(email_query)

    if email_exists:
        raise HTTPException(
            status_code=409,
            detail="Email already exists",
        )

    if len(password) < 8:
        raise HTTPException(
            status_code=400,
            detail="Invalid password length",
        )

    hashed_password = hash_password(password=password)

    new_user = User(
        username=username,
        email=email,
        password_hash=hashed_password,
    )

    database.add(new_user)
    database.commit()
    database.refresh(new_user)

    access_token = create_access_token(new_user.id)

    return AuthResponse(
        access_token=access_token,
        token_type="bearer",
    )


@router.post("/login")
def Login(
    user: LoginRequest, database: Session = Depends(get_database_session)
) -> AuthResponse:
    username_or_email = user.username_or_email.strip()
    password = user.password.strip()

    if "@" in username_or_email:
        if not check_email(email=username_or_email):
            raise HTTPException(
                status_code=400,
                detail="Invalid email format",
            )

    else:
        if len(username_or_email) < 3 or len(username_or_email) > 50:
            raise HTTPException(
                status_code=400,
                detail="Invalid username length",
            )

        if not check_username_char(username=username_or_email):
            raise HTTPException(
                status_code=400,
                detail="Invalid username characters",
            )

    query = select(User).where(
        or_(
            User.username == username_or_email,
            User.email == username_or_email,
        )
    )

    database_user = database.scalar(query)

    if database_user is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid username/email or password",
        )

    password_correct = verify_password(
        password=password, hashed_password=database_user.password_hash
    )

    if not password_correct:
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
def Me(current_user: User = Depends(get_current_user)) -> User:
    return current_user
