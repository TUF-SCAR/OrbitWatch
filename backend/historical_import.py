"""Explicit bounded archive download, validation, migration and import.

No commands run on application startup. A database target must be supplied in
HISTORICAL_DATABASE_URL; remote writes additionally require --allow-remote.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime


def target_engine(allow_remote):
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url
    value = os.getenv('HISTORICAL_DATABASE_URL')
    if not value:
        raise ValueError('Set HISTORICAL_DATABASE_URL explicitly; no default database may be modified')
    url = make_url(value)
    if url.get_backend_name() != 'postgresql':
        raise ValueError('Historical storage requires PostgreSQL')
    if url.host not in ('127.0.0.1','localhost','::1') and not allow_remote:
        raise ValueError('Remote database writes require separately authorized --allow-remote')
    return create_engine(value, hide_parameters=True, connect_args={'connect_timeout':5})


def inspect_archive(path):
    from services.historical_archive import archive_records
    from services.historical_tracker import normalize_elements
    records = archive_records(path)
    manifest_path = Path(str(path).removesuffix('.gz'))
    manifest = json.loads(manifest_path.read_text())
    import gzip
    raw = gzip.decompress(Path(path).read_bytes())
    if manifest.get('state') != 'complete' or hashlib.sha256(raw).hexdigest() != manifest.get('sha256'):
        raise ValueError('Archive provenance/integrity check failed')
    values = [normalize_elements(record) for record in records]
    counts = {}
    for norad_id in sorted({row['norad_id'] for row in values}):
        epochs = sorted({row['epoch'] for row in values if row['norad_id'] == norad_id})
        counts[norad_id] = dict(records=sum(row['norad_id']==norad_id for row in values),
            first_epoch=epochs[0].isoformat(), last_epoch=epochs[-1].isoformat(),
            largest_epoch_gap_seconds=max(((b-a).total_seconds() for a,b in zip(epochs,epochs[1:])),default=0))
    return values, dict(records=len(values), unique_elements=len({row['record_id'] for row in values}),
                       raw_bytes=len(raw), compressed_bytes=Path(path).stat().st_size, coverage=counts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command',required=True)
    download = commands.add_parser('download')
    download.add_argument('--ids',required=True)
    download.add_argument('--start',required=True); download.add_argument('--end',required=True)
    inspect = commands.add_parser('inspect'); inspect.add_argument('archive',type=Path)
    migrate = commands.add_parser('migrate'); migrate.add_argument('--allow-remote',action='store_true')
    importer = commands.add_parser('import'); importer.add_argument('archive',type=Path)
    importer.add_argument('--allow-remote',action='store_true')
    args = parser.parse_args()
    engine = None
    try:
        if args.command == 'download':
            from services.historical_archive import download_history
            manifest,path = download_history([int(value) for value in args.ids.split(',')],args.start,args.end)
            print(json.dumps({'archive':str(path),'manifest':manifest},indent=2));return
        if args.command == 'inspect':
            _,report = inspect_archive(args.archive);print(json.dumps(report,indent=2));return
        engine = target_engine(args.allow_remote)
        if args.command == 'migrate':
            sql = (Path(__file__).parent/'migrations/001_historical_elements.sql').read_text()
            with engine.connect() as connection:
                connection.exec_driver_sql(sql)
            print('Historical migration applied to the explicitly selected target.');return
        values,report = inspect_archive(args.archive)
        from repositories.historical_elements import import_historical_records
        report['inserted'] = import_historical_records(values,engine)
        from sqlalchemy import text
        with engine.connect() as connection:
            report['storage'] = dict(connection.execute(text("SELECT count(*) AS rows, round(avg(pg_column_size(h)))::int AS mean_row_bytes, pg_total_relation_size('satellite_historical_elements') AS table_and_indexes_bytes FROM satellite_historical_elements h")).mappings().one())
        print(json.dumps(report,indent=2))
    except Exception as error:
        # Do not print SQLAlchemy/HTTP exception strings or connection details.
        print(json.dumps({'state':'failed','error_type':type(error).__name__,
                          'action':'Verify target authorization, archive status/integrity, supported elements and provider cooldowns.'}))
        raise SystemExit(1) from None
    finally:
        if engine is not None:engine.dispose()


if __name__ == '__main__':
    main()
