from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from contextlib import contextmanager
from core.config import required
from core.availability import DatabaseAvailability, DatabaseUnavailable


def get_database_engine():

    DATABASE_URL = required("DATABASE_URL")
    options = {}
    if make_url(DATABASE_URL).get_backend_name() == "postgresql":
        options = dict(pool_size=5, max_overflow=0, pool_timeout=3,
                       connect_args={"connect_timeout": 3, "options": "-c statement_timeout=8000"})
    database_engine = create_engine(
        url=DATABASE_URL,
        pool_pre_ping=True,
        hide_parameters=True,
        **options,
    )

    return database_engine


database_engine = get_database_engine()

_session_factory = sessionmaker(
    bind=database_engine,
    autoflush=False,
    expire_on_commit=False,
)


class DatabaseBase(DeclarativeBase):
    pass


def probe_database():
    # Readiness includes the existing schema, not just a TCP connection. No DDL.
    with database_engine.connect() as connection:
        for table in ("users", "satellite_orbit_data", "satellite_orbit_history"):
            connection.execute(text(f"SELECT 1 FROM {table} LIMIT 0"))


database_availability = DatabaseAvailability(probe_database)


@contextmanager
def database_session_maker():
    database_availability.ensure()
    try:
        with _session_factory() as session:
            yield session
    except SQLAlchemyError as error:
        database_availability.failed(error)
        raise DatabaseUnavailable() from None


def get_database_session():
    with database_session_maker() as database_session:
        yield database_session


if __name__ == "__main__":
    print("Running database.py directly")
