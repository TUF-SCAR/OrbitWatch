from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session
from core.database import get_database_session
from models.user import User
from services.auth import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


def check_username_char(username: str) -> bool:
    char_check = True
    for char in username:
        if not char.isalpha() and not char.isnumeric() and char != "." and char != "_":
            char_check = False
            break

    return char_check


def check_email(email: str) -> bool:
    if email != "":
        if len(email) <= 254:
            if email.count("@") == 1:
                local_email = email.split("@")[0]
                domain_email = email.split("@")[1]
                if local_email != "":
                    if len(local_email) >= 3 and len(local_email) <= 64:
                        local_check = True
                        local_char_check = False
                        for char in local_email:
                            if (
                                not char.isalpha()
                                and not char.isnumeric()
                                and char != "."
                                and char != "-"
                                and char != "_"
                                and char != "+"
                            ):
                                local_char_check = True
                                break
                        if (
                            local_char_check
                            or local_email.startswith(".")
                            or local_email.endswith(".")
                            or ".." in local_email
                        ):
                            local_check = False

                        if local_check:
                            if domain_email != "" and len(domain_email) <= 253:
                                if (
                                    domain_email.count(".") >= 1
                                    and not domain_email.startswith(".")
                                    and not domain_email.endswith(".")
                                    and " " not in domain_email
                                ):
                                    domain_labels = domain_email.split(".")
                                    TLD = domain_labels[-1]
                                    label_check = True

                                    for label in domain_labels:
                                        domain_char_check = False
                                        for char in label:
                                            if (
                                                not char.isalpha()
                                                and not char.isnumeric()
                                                and char != "-"
                                            ):
                                                domain_char_check = True
                                                break

                                        if (
                                            label == ""
                                            or domain_char_check
                                            or label.startswith("-")
                                            or label.endswith("-")
                                        ):
                                            label_check = False
                                            break

                                    if label_check:
                                        if len(TLD) >= 2 and TLD.isalpha():
                                            return True
    return False


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    database: Session = Depends(get_database_session),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        user_id = decode_access_token(credentials.credentials)
    except RuntimeError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    query = select(User).where(User.id == user_id)

    database_user = database.scalar(query)

    if database_user is None:
        raise HTTPException(status_code=401, detail="User no longer exists")

    return database_user
