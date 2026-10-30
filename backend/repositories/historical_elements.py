from contextlib import contextmanager
from datetime import timedelta
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from core.database import database_engine, database_availability
from core.availability import DatabaseUnavailable
from models.historical_elements import HistoricalElements
from services.historical_catalog import HISTORICAL_IDS, check_historical_ids

MAX_ELEMENT_AGE_SECONDS = 86400
PILOT_STORAGE_BYTES = 50 * 1024 * 1024


class HistoricalArchiveUnavailable(RuntimeError):
    pass


@contextmanager
def historical_session():
    database_availability.ensure()
    try:
        with Session(database_engine) as session:
            yield session
    except SQLAlchemyError as error:
        if getattr(getattr(error, 'orig', None), 'sqlstate', None) == '42P01':
            # A pending historical migration must not poison Live readiness.
            raise HistoricalArchiveUnavailable('Historical archive has not been deployed') from None
        database_availability.failed(error)
        raise DatabaseUnavailable() from None


def historical_records(norad_ids, timestamp):
    check_historical_ids(norad_ids)
    # Only use an element set published for an epoch at/before the selected
    # instant. Never extrapolate back before the first stored orbital epoch.
    cutoff = timestamp - timedelta(seconds=MAX_ELEMENT_AGE_SECONDS)
    result = {}
    with historical_session() as session:
        for norad_id in norad_ids:
            row = session.scalar(select(HistoricalElements).where(
                HistoricalElements.norad_id == norad_id,
                HistoricalElements.epoch <= timestamp,
                HistoricalElements.epoch >= cutoff,
            ).order_by(HistoricalElements.epoch.desc(),
                       func.length(HistoricalElements.source_record_id).desc().nulls_last(),
                       HistoricalElements.source_record_id.desc().nulls_last(), HistoricalElements.record_id).limit(1))
            if row is not None:
                result[norad_id] = {column.name: getattr(row, column.name) for column in HistoricalElements.__table__.columns}
    return result


def historical_coverage():
    with historical_session() as session:
        rows = session.execute(select(HistoricalElements.norad_id, func.count(),
            func.min(HistoricalElements.epoch), func.max(HistoricalElements.epoch)
        ).where(HistoricalElements.norad_id.in_(HISTORICAL_IDS)).group_by(HistoricalElements.norad_id)).all()
    counts = {row[0]: row for row in rows}
    return [dict(norad_id=norad_id, element_count=counts[norad_id][1] if norad_id in counts else 0,
                 first_epoch=counts[norad_id][2].isoformat() if norad_id in counts else None,
                 last_epoch=counts[norad_id][3].isoformat() if norad_id in counts else None,
                 max_element_age_seconds=MAX_ELEMENT_AGE_SECONDS,
                 coverage_note='Epoch bounds are not continuous coverage; each requested instant is validated.')
            for norad_id in HISTORICAL_IDS]


def import_historical_records(values, engine):
    """Explicit importer; the caller must authorize and verify the target."""
    if len(values) > 5000:
        raise ValueError('Import at most 5000 element sets per archive')
    if any(row['norad_id'] not in HISTORICAL_IDS for row in values):
        raise ValueError('Import contains a satellite outside the permanent catalog')
    if not values:
        return 0
    from sqlalchemy import text
    with engine.begin() as connection:
        # Serialize pilot-size accounting across explicit import processes.
        connection.execute(text('SELECT pg_advisory_xact_lock(574019315)'))
        size = connection.scalar(text("SELECT pg_total_relation_size('satellite_historical_elements')"))
        estimate = sum(len(str(row['elements']).encode()) + 600 for row in values)
        if size + estimate * 3 > PILOT_STORAGE_BYTES:
            raise ValueError('Import would exceed the conservative 50 MiB historical pilot budget')
        saved = 0
        for offset in range(0, len(values), 200):
            statement = insert(HistoricalElements).values(values[offset:offset+200]).on_conflict_do_nothing(index_elements=['record_id']).returning(HistoricalElements.record_id)
            saved += len(connection.execute(statement).scalars().all())
        if connection.scalar(text("SELECT pg_total_relation_size('satellite_historical_elements')")) > PILOT_STORAGE_BYTES:
            raise ValueError('Historical pilot budget exceeded; transaction rolled back')
    return saved
