"""Explicit bounded ERA5 operations. No startup/download side effects.

status; plan; migrate --expected-target FP; download --year YEAR (submit/poll once,
rerun to resume); inspect FILE; import FILE --expected-target FP.
"""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.engine import make_url
from core.config import required
from services.historical_weather_codec import DATASET, PROVIDER, GRID, SPECS, encode, decode, MAX_BLOB
from services.era5_source import (MAX_SOURCE, SEASONAL_TARGET_COUNT,
    read_grib, request_for_years, request_timestamps, seasonal_progress)
from services.historical_weather_storage import SnapshotStorage, BUCKET
from services.historical_capacity import require_capacity
from services.providers.budget import ROOT, refresh_owner, budget

ARCHIVE=ROOT/'era5'
EXPECTED='91629c91746ef7a1'
CDS_IN_FLIGHT = {'accepted', 'running', 'queued', 'pending'}
CDS_TERMINAL_FAILURE = {'failed', 'dismissed', 'rejected', 'cancelled', 'canceled'}
OPEN_MANIFEST = {'queued', 'submission_uncertain', 'staged'}


def target(expected=None):
    url=make_url(required('DATABASE_URL'))
    fp=sha256(f'{url.host}|{url.username}|{url.database}'.encode()).hexdigest()[:16]
    if not url.host or not url.host.endswith(('.supabase.com','.supabase.co')) or url.get_backend_name()!='postgresql' or fp!=EXPECTED or expected is not None and fp!=expected:
        raise ValueError('OrbitWatch project fingerprint mismatch')
    return create_engine(url,hide_parameters=True,connect_args={'connect_timeout':5,'options':'-c statement_timeout=30000 -c lock_timeout=5000'}),fp


def storage_usage(connection):
    # Read-only Storage metadata; no direct writes to the Storage schema.
    result=dict(connection.execute(text("SELECT count(*) AS objects, COALESCE(sum((metadata->>'size')::bigint),0) AS bytes, count(*) FILTER (WHERE metadata->>'size' IS NULL) AS unknown_size_objects FROM storage.objects")).mappings().one())
    return {key:int(value) for key,value in result.items()}


def measurement(connection):
    return dict(database_bytes=connection.scalar(text('SELECT pg_database_size(current_database())')),
        storage=storage_usage(connection),
        satellite_records=connection.scalar(text('SELECT count(*) FROM satellite_historical_elements')),
        users=connection.scalar(text('SELECT count(*) FROM users')))


def capacity(measured,blob_bytes=MAX_BLOB):
    if measured['storage'].get('unknown_size_objects',0): raise ValueError('Storage usage cannot be established')
    require_capacity(measured, 1_000_000)
    if measured['storage']['bytes']+blob_bytes>=750_000_000: raise ValueError('Storage reserve at risk')


def migrate(expected):
    engine,fp=target(expected)
    try:
        with engine.begin() as db:
            db.execute(text('SELECT pg_advisory_xact_lock(68270906)'))
            before=measurement(db);capacity(before)
            sql=(Path(__file__).parent/'migrations/006_historical_weather.sql').read_text(encoding='utf8')
            db.exec_driver_sql(re.sub(r'(?m)^BEGIN;\s*$|^COMMIT;\s*$','',sql))
            columns={c['name'] for c in inspect(db).get_columns('historical_weather_snapshots')}
            if not {'timestamp','version','object_key','variables','sha256','provenance','compressed_bytes','status'}.issubset(columns): raise ValueError('Incompatible existing weather table')
            if not db.scalar(text("SELECT relrowsecurity FROM pg_class WHERE oid='public.historical_weather_snapshots'::regclass")): raise ValueError('Weather index requires RLS')
            after=measurement(db);capacity(after)
            if before['users']!=after['users'] or before['satellite_records']!=after['satellite_records']: raise ValueError('Unrelated rows changed')
        with engine.connect() as db: after=measurement(db)
        return dict(target_fingerprint=fp,before=before,after=after,applied=True)
    finally: engine.dispose()


def cds_settings():
    cfg={}
    for path in (Path(os.getenv('CDSAPI_RC',str(Path.home()/'.cdsapirc'))),Path(os.getenv('ECMWF_DATASTORES_RC_FILE',str(Path.home()/'.ecmwfdatastoresrc')))):
        if path.is_file():
            # CDS rc files contain simple url/key scalars. Never print their values.
            for line in path.read_text(encoding='utf8').splitlines():
                name,sep,value=line.partition(':')
                if sep and name.strip() in ('url','key'): cfg[name.strip()]=value.strip().strip('\"\'')
    key=os.getenv('CDSAPI_KEY') or os.getenv('ECMWF_DATASTORES_KEY') or cfg.get('key')
    url=os.getenv('CDSAPI_URL') or os.getenv('ECMWF_DATASTORES_URL') or cfg.get('url') or 'https://cds.climate.copernicus.eu/api'
    if url.rstrip('/')!='https://cds.climate.copernicus.eu/api': raise ValueError('Only official CDS endpoint allowed')
    if not key: raise ValueError('Missing CDS personal access token; account and manually accepted dataset terms required')
    return url,key


def manifests():
    return [(path, json.loads(path.read_text(encoding='utf8'))) for path in sorted(ARCHIVE.glob('*.json'))]


def write_manifest(path, manifest):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf8', dir=path.parent, delete=False) as file:
        temporary = Path(file.name)
        json.dump(manifest, file, indent=2)
        file.flush()
        os.fsync(file.fileno())
    try:
        temporary.replace(path)
        if os.name != 'nt':
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def stored_timestamps(db):
    return db.scalars(text('SELECT DISTINCT timestamp FROM historical_weather_snapshots ORDER BY timestamp')).all()


def inventory(include_plan=False):
    engine,fp=target()
    try:
        with engine.begin() as db:
            db.execute(text('SET TRANSACTION READ ONLY'))
            usage=measurement(db)
            dates=stored_timestamps(db)
            bucket=bool(db.scalar(text('SELECT 1 FROM storage.buckets WHERE id=:bucket AND NOT public'),{'bucket':BUCKET}))
        result=dict(target_fingerprint=fp,usage=usage,private_weather_bucket=bucket,
                    stored_timestamps=[date.isoformat() for date in dates])
        try:cds_settings();result['cds_configured']=True
        except ValueError:result['cds_configured']=False
        result['storage_configured']=bool(os.getenv('SUPABASE_URL') and (os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_SECRET_KEY')))
        if include_plan:
            result['planned_count']=SEASONAL_TARGET_COUNT
            result['years']=seasonal_progress(dates,[manifest for _,manifest in manifests()])
        return result
    finally:engine.dispose()


def check_provider_history(client, request, known_ids):
    """Fence submissions against current account jobs, including manual ones."""
    page = client.get_jobs(limit=100, sortby='-created')
    seen = set()
    for _ in range(10):
        if page is None or not page.request_ids:
            return
        for entry in page.response.json()['jobs']:
            job_id = entry['jobID']
            if job_id in seen:
                continue
            seen.add(job_id)
            detail = entry if 'status' in entry else client.get_remote(job_id).json
            state = detail.get('status')
            if state in CDS_IN_FLIGHT:
                raise ValueError('An outstanding CDS account job needs reconciliation')
            if state not in CDS_TERMINAL_FAILURE | {'successful'}:
                raise ValueError('Unrecognized CDS account job state')
            if job_id in known_ids:
                continue
            if 'processID' not in detail or (detail['processID'] == DATASET and 'metadata' not in detail):
                detail = client.get_remote(job_id).json
            if detail['processID'] == DATASET:
                years = detail['metadata']['request']['ids']['year']
                if set(request['year']) & {str(year) for year in years}:
                    raise ValueError('CDS history already contains an unsaved request for this year')
        page = page.next
    if page is not None and page.request_ids:
        raise ValueError('Provider history could not be reconciled within its page bound')


def finalize_source(path, manifest):
    file = path.with_suffix('.grib')
    partial = path.with_suffix('.grib.part')
    source = file if file.exists() else partial
    if (not source.is_file() or not 0 < source.stat().st_size <= MAX_SOURCE
            or sha256(source.read_bytes()).hexdigest() != manifest.get('source_sha256')):
        raise ValueError('Saved download failed integrity; inspect it without resubmitting')
    if manifest['state'] == 'staged':
        if source == partial:
            partial.replace(file)
        manifest['state'] = 'downloaded'
        write_manifest(path, manifest)
    elif source != file:
        raise ValueError('Saved download is missing; inspect it without resubmitting')
    return manifest


def receive_source(path, manifest, result):
    import httpx
    from urllib.parse import urlsplit

    if not 0 < result.content_length <= MAX_SOURCE:
        raise ValueError('Source size exceeds bound')
    parsed = urlsplit(result.location)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or not parsed.hostname.endswith(('.ecmwf.int', '.climate.copernicus.eu', '.cloudfss.com'))):
        raise ValueError('Unreviewed CDS result host')
    start = time.monotonic()
    size, digest = 0, sha256()
    with httpx.stream('GET', result.location, timeout=60, follow_redirects=False) as response:
        response.raise_for_status()
        with path.with_suffix('.grib.part').open('wb') as stream:
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > MAX_SOURCE or time.monotonic() - start > 600:
                    raise ValueError('Source transfer exceeds bound')
                digest.update(chunk)
                stream.write(chunk)
            stream.flush()
            os.fsync(stream.fileno())
    if size != result.content_length:
        raise ValueError('Truncated source download')
    manifest.update(state='staged', source_sha256=digest.hexdigest(), source_bytes=size,
                    transfer_seconds=round(time.monotonic()-start, 3),
                    downloaded_at=datetime.now(timezone.utc).isoformat())
    write_manifest(path, manifest)
    return finalize_source(path, manifest)


def download(year, *, months=None):
    return download_batch((year,), months=months)


def download_batch(years, *, months=None):
    """Advance an immutable request or reserve an exact group under the import lock."""
    from ecmwf.datastores import Client

    request = request_for_years(years)
    if months is not None:
        if not months or not set(months) <= set(request['month']):
            raise ValueError('Requested campaign months are not eligible final ERA5')
        request['month'] = [month for month in request['month'] if month in months]
    requested = request_timestamps(request)
    ARCHIVE.mkdir(parents=True,exist_ok=True)
    with refresh_owner('era5-import.lock') as owned:
        if not owned: raise ValueError('Another ERA5 operation is running')
        engine, _ = target()
        try:
            with engine.begin() as db:
                db.execute(text('SET TRANSACTION READ ONLY'))
                capacity(measurement(db), len(requested)*MAX_BLOB)
                stored = set(stored_timestamps(db))
        finally:
            engine.dispose()
        saved = [(path, item, request_timestamps(item['request'])) for path,item in manifests()
                 if item.get('dataset') == DATASET]
        outstanding = [row for row in saved if row[1].get('state') in OPEN_MANIFEST]
        if len(outstanding) > 1:
            raise ValueError('Multiple saved CDS jobs need reconciliation')
        matching = [row for row in saved if row[2] & (requested - stored)
                    or row[1].get('state') in OPEN_MANIFEST | {'downloaded'} and row[2] <= requested]
        if len(matching) > 1:
            raise ValueError('Overlapping saved CDS jobs need reconciliation')
        if not requested - stored and not matching:
            return {'state': 'already_stored'}
        if outstanding and outstanding[0] not in matching:
            raise ValueError('Resume the existing saved CDS job before submitting another')
        if matching:
            path, manifest, dates = matching[0]
            if not dates <= requested:
                raise ValueError('Saved request exceeds approved campaign dates')
            if manifest['state'] in ('staged', 'downloaded'):
                return finalize_source(path, manifest)
            if manifest['state'] != 'queued' or not manifest.get('job_id'):
                raise ValueError('Inspect saved job before any retry; automatic resubmission prohibited')
        else:
            if len(request['year']) > 1 and (requested & stored or any(
                    set(item['request']['year']) & set(request['year']) for _,item,_ in saved)):
                raise ValueError('Multi-year requests require previously unsubmitted full years')
            request['month'] = [month for month in request['month'] if any(
                date.month == int(month) and date not in stored for date in requested)]
            request_timestamps(request)
            identity = sha256(json.dumps(request,sort_keys=True).encode()).hexdigest()[:24]
            path = ARCHIVE / (identity+'.json')
            if path.exists():
                raise ValueError('CDS manifest identity requires reconciliation')
            manifest = {'dataset': DATASET, 'request': request, 'state': 'reserved'}
        staged = sum(file.stat().st_size for file in ARCHIVE.glob('*.grib*')
                     if file != path.with_suffix('.grib.part'))
        if staged + MAX_SOURCE > 256*1024*1024 or shutil.disk_usage(ARCHIVE).free < MAX_SOURCE*3:
            raise ValueError('Local pilot quota/disk limit')
        url,key=cds_settings()
        SnapshotStorage()
        client=Client(url=url,key=key,timeout=30,maximum_tries=1,cleanup=False)
        with budget.attempt('cds-era5',60,1):
            if not manifest.get('job_id'):
                check_provider_history(client, request, {item.get('job_id') for _,item,_ in saved})
                manifest['state']='submission_uncertain'
                write_manifest(path,manifest)
                remote=client.submit(DATASET,manifest['request'])
                manifest.update(job_id=remote.request_id,state='queued')
                write_manifest(path,manifest)
            else: remote=client.get_remote(manifest['job_id'])
            detail=remote.json
            state=detail['status']
            manifest['provider_state']=state
            manifest['provider_times'] = {name: detail[name] for name in ('created','started','finished') if detail.get(name)}
            if state in CDS_TERMINAL_FAILURE:
                manifest['state']='failed'
            elif state == 'successful':
                if 'success_observed_at' not in manifest:
                    manifest['success_observed_at'] = datetime.now(timezone.utc).isoformat()
                    write_manifest(path, manifest)
                return receive_source(path, manifest, remote.get_results())
            elif state not in CDS_IN_FLIGHT:
                raise ValueError('Unrecognized saved CDS job state')
            write_manifest(path,manifest)
            return manifest


def prepare(path):
    path=Path(path)
    manifest=json.loads(path.with_suffix('.json').read_text(encoding='utf8'))
    results=read_grib(path,manifest)
    prepared=[]
    for date,result in sorted(results.items()):
        blob,header=encode(date,result['fields'],result['provenance']);decode(blob)
        checksum=sha256(blob).hexdigest()
        key=f'era5/v1/{date.strftime("%Y%m%dT%H%M%SZ")}/{checksum}.owwx'
        status='complete' if set(header['fields'])==set(SPECS) and not any(f['missing_nodes'] for f in header['fields'].values()) else 'partial'
        prepared.append((date,blob,header,key,checksum,status))
    return prepared


def publish(path,expected,storage=None,*,complete_only=False,on_snapshot=None):
    with refresh_owner('era5-import.lock') as owned:
        if not owned: raise ValueError('Another ERA5 operation is running')
        start = time.monotonic()
        prepared=prepare(path)
        request=json.loads(Path(path).with_suffix('.json').read_text(encoding='utf8'))['request']
        dates = request_timestamps(request)
        imported = {item[0] for item in prepared}
        if len(prepared) != len(imported) or not imported <= dates:
            raise ValueError('Unexpected or duplicate prepared dates')
        missing = sorted(date.isoformat().replace('+00:00','Z') for date in dates - imported)
        if complete_only and (missing or not prepared or any(item[-1] != 'complete' for item in prepared)):
            raise ValueError('Campaign requires complete ERA5 source fields and timestamps')
        validation_seconds = round(time.monotonic()-start, 3)
        engine,fp=target(expected)
        latest = text('SELECT version,sha256 FROM historical_weather_snapshots WHERE timestamp=:date ORDER BY version DESC LIMIT 1')
        try:
            with engine.begin() as db:
                db.execute(text('SELECT pg_advisory_xact_lock(68270906)'))
                before=measurement(db)
                pending = []
                for item in prepared:
                    date, _, _, _, checksum, _ = item
                    existing = db.execute(latest, {'date':date}).mappings().first()
                    if existing and existing['sha256'] == checksum:
                        continue
                    if complete_only and existing:
                        raise ValueError('Stored campaign snapshot conflicts with source')
                    pending.append(item)
                capacity(before, sum(len(item[1]) for item in pending))
            storage=storage or SnapshotStorage();storage.ensure_bucket()
            inserted=0
            for date,blob,header,key,checksum,status in pending:
                with engine.begin() as db:
                    db.execute(text('SELECT pg_advisory_xact_lock(68270906)'))
                    capacity(measurement(db),len(blob))
                # Upload first; checksum GET verification precedes metadata visibility.
                storage.put_verified(key,blob)
                with engine.begin() as db:
                    db.execute(text('SELECT pg_advisory_xact_lock(68270906)'))
                    capacity(measurement(db),0)
                    existing=db.execute(latest,{'date':date}).mappings().first()
                    if existing and existing['sha256']==checksum: continue
                    if complete_only and existing:
                        raise ValueError('Stored campaign snapshot conflicts with source')
                    version=existing['version']+1 if existing else 1
                    db.execute(text('''INSERT INTO historical_weather_snapshots
                        (timestamp,version,provider,dataset,product,variables,grid,object_key,sha256,compressed_bytes,status,validated_at,provenance)
                        VALUES (:date,:version,:provider,:dataset,'reanalysis',CAST(:variables AS jsonb),CAST(:grid AS jsonb),:key,:checksum,:size,:status,now(),CAST(:provenance AS jsonb))'''),
                        dict(date=date,version=version,provider=PROVIDER,dataset=DATASET,variables=json.dumps(header['fields']),grid=json.dumps(GRID),key=key,checksum=checksum,size=len(blob),status=status,provenance=json.dumps(header['provenance'])))
                    inserted+=1
                if on_snapshot is not None:
                    with engine.begin() as db:
                        db.execute(text('SET TRANSACTION READ ONLY'))
                        measured=measurement(db)
                    on_snapshot(date, measured)
            with engine.connect() as db: after=measurement(db)
            return dict(target_fingerprint=fp,inserted=inserted,before=before,after=after,
                        unvalidated_timestamps=missing,validation_seconds=validation_seconds)
        finally:engine.dispose()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['status','plan','migrate','download','inspect','import']);parser.add_argument('--year',type=int);parser.add_argument('--file',type=Path);parser.add_argument('--expected-target')
    args=parser.parse_args()
    try:
        if args.command=='download': result=download(args.year)
        elif args.command=='migrate':
            if args.expected_target!=EXPECTED: raise ValueError('Explicit verified target required')
            result=migrate(args.expected_target)
        elif args.command=='import':
            if args.expected_target!=EXPECTED: raise ValueError('Explicit verified target required')
            result=publish(args.file,args.expected_target)
        elif args.command=='inspect':
            with refresh_owner('era5-import.lock') as owned:
                if not owned: raise ValueError('Another ERA5 operation is running')
                result=[dict(timestamp=x[0].isoformat(),bytes=len(x[1]),variables=x[2]['fields'],status=x[5]) for x in prepare(args.file)]
        else: result=inventory(include_plan=args.command=='plan')
        print(json.dumps(result,default=str,indent=2))
    except Exception as error:
        print(json.dumps(dict(state='failed',error_type=type(error).__name__,action='Check provider credentials, accepted dataset terms, saved manifest, scientific validation and capacity. No automatic retries.')))
        raise SystemExit(1) from None


if __name__=='__main__':main()
