"""Explicit bounded ERA5 operations. No startup/download side effects.

status; migrate --expected-target FP; download --year YEAR (submit/poll once,
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
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.engine import make_url
from core.config import required
from services.historical_weather_codec import DATASET, PROVIDER, GRID, SPECS, encode, decode, MAX_BLOB
from services.era5_source import request_for_year, read_grib, MAX_SOURCE
from services.historical_weather_storage import SnapshotStorage, BUCKET
from services.providers.budget import ROOT, refresh_owner, budget

ARCHIVE=ROOT/'era5'
EXPECTED='91629c91746ef7a1'


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
    if measured['database_bytes']+1_000_000>=300_000_000: raise ValueError('Normal PostgreSQL reserve at risk')
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


def download(year):
    """One grouped year/request; persistent job identity; never wait on CDS queue."""
    from ecmwf.datastores import Client
    import httpx
    url,key=cds_settings()
    request=request_for_year(year)
    ARCHIVE.mkdir(parents=True,exist_ok=True)
    if sum(f.stat().st_size for f in ARCHIVE.glob('*.grib*'))+MAX_SOURCE>256*1024*1024 or shutil.disk_usage(ARCHIVE).free<MAX_SOURCE*3: raise ValueError('Local pilot quota/disk limit')
    with refresh_owner('era5-import.lock') as owned:
        if not owned: raise ValueError('Another ERA5 operation is running')
        saved=[(path,json.loads(path.read_text(encoding='utf8'))) for path in sorted(ARCHIVE.glob('*.json'))]
        saved=[(path,m) for path,m in saved if m.get('dataset')==DATASET and m.get('request',{}).get('year')==[str(year)]]
        for path,m in saved:
            if m.get('state')=='downloaded':
                source=path.with_suffix('.grib')
                if not source.is_file() or source.stat().st_size>MAX_SOURCE or sha256(source.read_bytes()).hexdigest()!=m.get('source_sha256'):
                    raise ValueError('Saved download failed integrity; inspect it without resubmitting')
        pending=[(path,m) for path,m in saved if m.get('state')!='downloaded']
        if pending:
            manifest_path,manifest=pending[0];request=manifest['request']
            file=manifest_path.with_suffix('.grib')
        else:
            completed={month for _,m in saved for month in m['request']['month']}
            request['month']=[month for month in request['month'] if month not in completed]
            if not request['month']:return dict(state='already_downloaded',year=year,manifest_count=len(saved))
            identity=sha256(json.dumps(request,sort_keys=True).encode()).hexdigest()[:24]
            file=ARCHIVE/(identity+'.grib');manifest_path=ARCHIVE/(identity+'.json')
        manifest=json.loads(manifest_path.read_text(encoding='utf8')) if manifest_path.exists() else dict(dataset=DATASET,request=request,state='reserved')
        if manifest.get('state')=='downloaded':
            if not file.is_file() or sha256(file.read_bytes()).hexdigest()!=manifest.get('source_sha256'): raise ValueError('Saved download failed checksum')
            return manifest
        if manifest.get('state') in ('submission_uncertain','failed'): raise ValueError('Inspect saved job before any retry; automatic resubmission prohibited')
        client=Client(url=url,key=key,timeout=30,maximum_tries=1)
        with budget.attempt('cds-era5',60,1):
            if not manifest.get('job_id'):
                # A lost HTTP response must not cause an automatic duplicate request.
                manifest['state']='submission_uncertain';manifest_path.write_text(json.dumps(manifest,indent=2),encoding='utf8')
                remote=client.submit(DATASET,request)
                manifest.update(job_id=remote.request_id,state='queued')
                manifest_path.write_text(json.dumps(manifest,indent=2),encoding='utf8')
            else: remote=client.get_remote(manifest['job_id'])
            state=remote.status
            manifest['provider_state']=state
            if state in ('failed','dismissed'): manifest['state']='failed'
            elif remote.results_ready:
                result=remote.get_results()
                if not 0<result.content_length<=MAX_SOURCE: raise ValueError('Source size exceeds bound')
                # Download only once ready; bounded streaming, no queue wait.
                from urllib.parse import urlsplit
                parsed=urlsplit(result.location)
                if parsed.scheme!='https' or not parsed.hostname or not parsed.hostname.endswith(('.ecmwf.int','.climate.copernicus.eu','.cloudfss.com')): raise ValueError('Unreviewed CDS result host')
                partial=file.with_suffix('.grib.part')
                with httpx.stream('GET',result.location,timeout=60,follow_redirects=False) as response:
                    response.raise_for_status();size=0
                    with partial.open('wb') as stream:
                        for chunk in response.iter_bytes():
                            size+=len(chunk)
                            if size>MAX_SOURCE: raise ValueError('Source size exceeds bound')
                            stream.write(chunk)
                if size!=result.content_length: raise ValueError('Truncated source download')
                partial.replace(file)
                manifest.update(state='downloaded',source_sha256=sha256(file.read_bytes()).hexdigest(),source_bytes=size,downloaded_at=datetime.now(timezone.utc).isoformat())
            manifest_path.write_text(json.dumps(manifest,indent=2),encoding='utf8')
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


def publish(path,expected,storage=None):
    prepared=prepare(path)  # Entire source validates BEFORE creating/uploading anything.
    if len(prepared)>4: raise ValueError('Import batch cap is four snapshots')
    engine,fp=target(expected)
    try:
        with refresh_owner('era5-import.lock') as owned:
            if not owned: raise ValueError('Another ERA5 operation is running')
            with engine.begin() as db:
                db.execute(text('SELECT pg_advisory_xact_lock(68270906)'))
                before=measurement(db);capacity(before,sum(len(x[1]) for x in prepared))
            storage=storage or SnapshotStorage();storage.ensure_bucket()
            inserted=0
            for date,blob,header,key,checksum,status in prepared:
                # Upload first; checksum GET verification precedes metadata visibility.
                storage.put_verified(key,blob)
                with engine.begin() as db:
                    db.execute(text('SELECT pg_advisory_xact_lock(68270906)'))
                    capacity(measurement(db),0)
                    existing=db.execute(text('SELECT version,sha256 FROM historical_weather_snapshots WHERE timestamp=:date ORDER BY version DESC LIMIT 1'),{'date':date}).mappings().first()
                    if existing and existing['sha256']==checksum: continue
                    version=existing['version']+1 if existing else 1
                    db.execute(text('''INSERT INTO historical_weather_snapshots
                        (timestamp,version,provider,dataset,product,variables,grid,object_key,sha256,compressed_bytes,status,validated_at,provenance)
                        VALUES (:date,:version,:provider,:dataset,'reanalysis',CAST(:variables AS jsonb),CAST(:grid AS jsonb),:key,:checksum,:size,:status,now(),CAST(:provenance AS jsonb))'''),
                        dict(date=date,version=version,provider=PROVIDER,dataset=DATASET,variables=json.dumps(header['fields']),grid=json.dumps(GRID),key=key,checksum=checksum,size=len(blob),status=status,provenance=json.dumps(header['provenance'])))
                    inserted+=1
            with engine.connect() as db: after=measurement(db)
            return dict(target_fingerprint=fp,inserted=inserted,before=before,after=after)
    finally:engine.dispose()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['status','migrate','download','inspect','import']);parser.add_argument('--year',type=int);parser.add_argument('--file',type=Path);parser.add_argument('--expected-target')
    args=parser.parse_args()
    try:
        if args.command=='download': result=download(args.year)
        elif args.command=='migrate':
            if args.expected_target!=EXPECTED: raise ValueError('Explicit verified target required')
            result=migrate(args.expected_target)
        elif args.command=='import':
            if args.expected_target!=EXPECTED: raise ValueError('Explicit verified target required')
            result=publish(args.file,args.expected_target)
        elif args.command=='inspect': result=[dict(timestamp=x[0].isoformat(),bytes=len(x[1]),variables=x[2]['fields'],status=x[5]) for x in prepare(args.file)]
        else:
            engine,fp=target()
            try:
                with engine.connect() as db: result=dict(target_fingerprint=fp,usage=measurement(db))
                try:cds_settings();result['cds_configured']=True
                except ValueError:result['cds_configured']=False
                result['storage_configured']=bool(os.getenv('SUPABASE_URL') and (os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_SECRET_KEY')))
            finally:engine.dispose()
        print(json.dumps(result,default=str,indent=2))
    except Exception as error:
        print(json.dumps(dict(state='failed',error_type=type(error).__name__,action='Check provider credentials, accepted dataset terms, saved manifest, scientific validation and capacity. No automatic retries.')))
        raise SystemExit(1) from None


if __name__=='__main__':main()
