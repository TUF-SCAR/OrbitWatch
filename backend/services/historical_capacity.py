"""Measured, conservative limits for explicit archive expansion (decimal MB)."""
import shutil
from sqlalchemy import text

DATABASE_TARGET_BYTES = 275_000_000
DATABASE_ABSOLUTE_BYTES = 300_000_000
# Reserve room for indexes, transient writes and unrelated database growth.
WRITE_MARGIN_BYTES = 10_000_000


def storage_snapshot(connection):
    return dict(connection.execute(text("""SELECT
        pg_database_size(current_database()) AS database_bytes,
        pg_table_size('satellite_historical_elements') AS table_bytes,
        pg_indexes_size('satellite_historical_elements') AS index_bytes,
        pg_total_relation_size('satellite_historical_elements') AS historical_bytes,
        (SELECT count(*) FROM satellite_historical_elements) AS records
    """)).mappings().one())


def require_capacity(snapshot, estimated_bytes):
    if snapshot['database_bytes'] + estimated_bytes + WRITE_MARGIN_BYTES >= DATABASE_TARGET_BYTES:
        raise ValueError('Measured database capacity is insufficient for this bounded batch')


def retrieval_capacity(engine, root):
    from services.historical_archive import MAX_ARCHIVE_BYTES, MAX_ARCHIVE_RECORDS
    with engine.connect() as connection:
        snapshot = storage_snapshot(connection)
    # Worst bounded response plus row/index overhead, with 4x write allowance.
    require_capacity(snapshot, (MAX_ARCHIVE_BYTES + MAX_ARCHIVE_RECORDS * 1024) * 4)
    root.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(root).free < MAX_ARCHIVE_BYTES * 8:
        raise ValueError('Insufficient local disk capacity to preserve this archive')
    snapshot['local_free_bytes'] = shutil.disk_usage(root).free
    snapshot['local_archive_bytes'] = sum(path.stat().st_size for path in root.glob('*') if path.is_file())
    return snapshot
