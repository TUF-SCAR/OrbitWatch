from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from os import getenv
from dotenv import load_dotenv
from pathlib import Path


def get_database_engine():

    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        raise FileNotFoundError(f".env file not found at: {env_path}")

    load_dotenv(dotenv_path=env_path, override=True)

    DATABASE_URL = getenv("DATABASE_URL")
    if not DATABASE_URL or not DATABASE_URL.strip():
        raise RuntimeError("DATABASE_URL is missing or empty in backend/.env")

    database_engine = create_engine(
        url=DATABASE_URL,
        pool_pre_ping=True,
    )

    return database_engine


database_engine = get_database_engine()

database_session_maker = sessionmaker(
    bind=database_engine,
    autoflush=False,
    expire_on_commit=False,
)


class DatabaseBase(DeclarativeBase):
    pass


def get_database_session():
    with database_session_maker() as database_session:
        yield database_session


if __name__ == "__main__":
    print("Running database.py directly")
