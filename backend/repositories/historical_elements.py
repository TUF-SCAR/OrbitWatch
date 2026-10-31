from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
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
        epochs = session.execute(select(HistoricalElements.norad_id, HistoricalElements.epoch,
            HistoricalElements.launch_date, HistoricalElements.decay_date).where(
                HistoricalElements.norad_id.in_(HISTORICAL_IDS)).order_by(HistoricalElements.epoch)).all()
    windows = {norad_id: [] for norad_id in HISTORICAL_IDS}
    for norad_id, epoch, launch, decay in epochs:
        start, end = epoch, epoch + timedelta(seconds=MAX_ELEMENT_AGE_SECONDS)
        if launch: start = max(start, datetime.combine(launch, datetime.min.time(), timezone.utc))
        if decay: end = min(end, datetime.combine(decay, datetime.min.time(), timezone.utc)-timedelta(microseconds=1))
        if end < start: continue
        merged = windows[norad_id]
        if merged and start <= merged[-1][1]: merged[-1][1] = max(merged[-1][1], end)
        else: merged.append([start, end])
    counts = {row[0]: row for row in rows}
    return [dict(norad_id=norad_id, element_count=counts[norad_id][1] if norad_id in counts else 0,
                 first_epoch=counts[norad_id][2].isoformat() if norad_id in counts else None,
                 last_epoch=counts[norad_id][3].isoformat() if norad_id in counts else None,
                 max_element_age_seconds=MAX_ELEMENT_AGE_SECONDS,
                 valid_windows=[{'start':a.isoformat(), 'end':b.isoformat()} for a,b in windows[norad_id]],
                 coverage_note='Epoch bounds are not continuous coverage; each requested instant is validated.')
            for norad_id in HISTORICAL_IDS]


def coverage_shortcuts(objects):
    """Representative instants from actual validity windows, never epoch bounds."""
    from services.historical_catalog import HISTORICAL_DEFAULT_IDS
    candidates = set()
    for obj in objects:
        for window in obj['valid_windows']:
            start, end = map(datetime.fromisoformat, (window['start'], window['end']))
            cursor = start + min(timedelta(minutes=10), (end-start)/2)
            while cursor <= end:
                candidates.add(cursor); cursor += timedelta(days=1)
    best = {}
    for instant in sorted(candidates):
        ids = [obj['norad_id'] for obj in objects if any(
            datetime.fromisoformat(w['start']) <= instant <= datetime.fromisoformat(w['end']) for w in obj['valid_windows'])]
        defaults = sum(n in HISTORICAL_DEFAULT_IDS for n in ids)
        score = (defaults, len(ids))
        if instant.year not in best or score > best[instant.year][0]:
            best[instant.year] = (score, dict(timestamp=instant.isoformat(), norad_ids=ids,
                available_count=len(ids), default_count=defaults))
    return [best[year][1] for year in sorted(best)]


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
        from services.historical_capacity import storage_snapshot, require_capacity, DATABASE_TARGET_BYTES
        before = storage_snapshot(connection)
        size = connection.scalar(text("SELECT pg_total_relation_size('satellite_historical_elements')"))
        estimate = sum(len(str(row['elements']).encode()) + 600 for row in values)
        require_capacity(before, estimate * 4)
        if size + estimate * 3 > PILOT_STORAGE_BYTES:
            raise ValueError('Import would exceed the conservative 50 MiB historical pilot budget')
        saved = 0
        for offset in range(0, len(values), 200):
            statement = insert(HistoricalElements).values(values[offset:offset+200]).on_conflict_do_nothing(index_elements=['record_id']).returning(HistoricalElements.record_id)
            saved += len(connection.execute(statement).scalars().all())
        if connection.scalar(text("SELECT pg_total_relation_size('satellite_historical_elements')")) > PILOT_STORAGE_BYTES:
            raise ValueError('Historical pilot budget exceeded; transaction rolled back')
        if storage_snapshot(connection)['database_bytes'] >= DATABASE_TARGET_BYTES:
            raise ValueError('Database operating target exceeded; transaction rolled back')
    return saved
