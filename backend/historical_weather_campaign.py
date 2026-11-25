"""One-shot, resumable publication of the approved seasonal ERA5 archive."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
import logging
import math
from pathlib import Path
import shutil
import time

from ecmwf.datastores import Client
import httpx
from requests import RequestException
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from historical_weather_import import (
    ARCHIVE, BUCKET, EXPECTED, capacity, cds_settings, download, manifests,
    measurement, publish, target, write_manifest,
)
from services.era5_source import DATASET
from services.historical_capacity import require_capacity, storage_snapshot
from services.historical_weather_codec import SPECS
from services.historical_weather_storage import SnapshotStorage, WeatherStorageUnavailable
from services.providers.budget import ROOT, ProviderDeferred, budget, refresh_owner

PRIORITIES = (2000, 1970, 1980, 1990, 2010, 2020)
YEARS = (*PRIORITIES, *(year for year in range(1970, 2027) if year not in PRIORITIES))
CHECKPOINT = ROOT / 'era5-campaign' / 'progress.json'
DB_QUOTA = 500_000_000
STORAGE_QUOTA = 1_000_000_000
PILOT_YEAR = 2024
QUARTERS = ('01', '04', '07', '10')
RETRYABLE = (RequestException, httpx.RequestError, OperationalError, WeatherStorageUnavailable)


class CampaignStop(RuntimeError):
    pass


def months(year):
    return QUARTERS[:3] if year == 2026 else QUARTERS


def approved_dates(year):
    return {f'{year}-{month}-15T12:00:00+00:00' for month in months(year)}


APPROVED = set().union(*(approved_dates(year) for year in YEARS))


def checkpoint(state):
    state['updated_at'] = datetime.now(timezone.utc).isoformat()
    CHECKPOINT.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    write_manifest(CHECKPOINT, state)


def inventory():
    engine, _ = target(EXPECTED)
    try:
        with engine.begin() as db:
            db.execute(text('SET TRANSACTION READ ONLY'))
            measured = measurement(db)
            satellite = storage_snapshot(db)
            rows = db.execute(text('''SELECT timestamp, status, object_key, sha256, compressed_bytes
                FROM historical_weather_snapshots ORDER BY timestamp''')).mappings().all()
            objects = db.execute(text('''SELECT name, (metadata->>'size')::bigint AS bytes
                FROM storage.objects WHERE bucket_id=:bucket'''), {'bucket': BUCKET}).all()
    finally:
        engine.dispose()
    indexed = {row['timestamp'].isoformat(): dict(row) for row in rows}
    if len(indexed) != len(rows) or set(indexed) - APPROVED or any(row['status'] != 'complete' for row in rows):
        raise CampaignStop('Production archive contains duplicate, unapproved or incomplete rows')
    stored = dict(objects)
    if any(stored.get(row['object_key']) != row['compressed_bytes'] for row in rows):
        raise CampaignStop('Private object inventory differs from published metadata')
    return measured, satellite, indexed, stored


def estimate(state, measured):
    sizes = list(state['sizes'].values())
    remaining = len(APPROVED) - len(sizes)
    average = sum(sizes) / len(sizes)
    forecast = math.ceil(remaining * max(average * 1.25, max(sizes)))
    # Existing operating caps reserve more than the required 200 MB in both quotas.
    capacity(measured, forecast)
    require_capacity(measured, remaining * 65_536)
    state.update(database_bytes=measured['database_bytes'], database_free=DB_QUOTA-measured['database_bytes'],
        storage_bytes=measured['storage']['bytes'], storage_free=STORAGE_QUOTA-measured['storage']['bytes'],
        storage_objects=measured['storage']['objects'], avg_bytes=round(average), min_bytes=min(sizes), max_bytes=max(sizes),
        era5_indexed_bytes=sum(sizes), projected_storage_bytes=measured['storage']['bytes']+forecast,
        projected_database_bytes=measured['database_bytes']+remaining*65_536)


def verify_snapshot(state, date):
    from services import historical_weather as archive
    result = archive.snapshot(date)
    if not result or result['source'] != 'ERA5 reanalysis' or result['precipitation_period_seconds'] != 3600:
        raise CampaignStop('Production backend could not verify the ERA5 snapshot')
    meta = result['metadata']
    if meta['dataset'] != DATASET or meta['status'] != 'complete' or set(result['fields']) != set(SPECS):
        raise CampaignStop('Production backend returned incomplete ERA5 metadata')
    for name, field in result['fields'].items():
        if field['units'] != SPECS[name][0] or len(field['values']) != 65160 or None in field['values']:
            raise CampaignStop('Production backend returned an invalid field')
    point = archive.location(date, 17.39, 78.49)
    values = point['values']
    if (set(values) != set(SPECS) | {'wind_speed', 'wind_direction'} or
        not math.isclose(values['wind_speed'], math.hypot(values['u'], values['v'])*3.6) or
        (values['wind_direction'] is not None and not 0 <= values['wind_direction'] < 360)):
        raise CampaignStop('Production backend returned invalid wind components')
    archive.load_object.cache_clear()
    stamp = date.isoformat()
    state['sizes'][stamp] = meta['compressed_bytes']
    state['verified'][stamp] = meta['sha256']


def reconcile(state):
    measured, satellite, rows, objects = inventory()
    if not approved_dates(PILOT_YEAR) <= rows.keys():
        raise CampaignStop('Four existing 2024 snapshots are required')
    for stamp, row in rows.items():
        if stamp not in state['verified']:
            verify_snapshot(state, row['timestamp'])
        elif state['verified'][stamp] != row['sha256']:
            raise CampaignStop('A previously verified snapshot changed')
    if set(state['verified']) - rows.keys():
        raise CampaignStop('Production is missing a formerly verified snapshot')
    estimate(state, measured)
    state['counts_by_year'] = {str(year):len(approved_dates(year) & rows.keys()) for year in YEARS}
    state['satellite_bytes'] = satellite['historical_bytes']
    state['archive_disk_free'] = shutil.disk_usage(ROOT).free
    state['private_object_count'] = len(objects)
    state['private_object_bytes'] = sum(objects.values())
    if 'baseline' not in state:
        state['baseline'] = {'published': len(rows), 'database_bytes': measured['database_bytes'],
            'storage_bytes': measured['storage']['bytes'], 'private_object_bytes': sum(objects.values())}
    if len(rows) == len(APPROVED) and set(objects) != {row['object_key'] for row in rows.values()}:
        raise CampaignStop('Private Storage has objects without a campaign row')
    checkpoint(state)
    return set(rows)


def provider_conflicts():
    known = {item.get('job_id') for _, item in manifests()}
    url, key = cds_settings()
    client = Client(url=url, key=key, timeout=15, maximum_tries=1)
    page = client.get_jobs(limit=100, sortby='-created')
    conflicts = set()
    for _ in range(10):
        if page is None or not page.request_ids:
            return conflicts
        for job_id in set(page.request_ids) - known:
            job = client.get_remote(job_id)
            if job.collection_id == DATASET:
                conflicts.update(str(year) for year in job.request.get('year', []))
        page = page.next
    raise CampaignStop('Provider history could not be reconciled within its page bound')


def budget_sleep(deadline):
    with budget.connect() as db:
        row = db.execute("SELECT next_at,blocked FROM budgets WHERE name='cds-era5'").fetchone()
    if row and row[1]:
        raise CampaignStop('CDS authorization or rate-limit circuit needs review')
    delay = max(5, row[0]-time.time()) if row else 10
    time.sleep(max(0, min(delay, 240, deadline-time.monotonic())))


def publish_saved(year, state):
    expected = approved_dates(year)
    pending = [(path, item) for path, item in manifests() if item.get('dataset') == DATASET
        and item.get('state') == 'downloaded' and item.get('request', {}).get('year') == [str(year)]]
    for path, item in pending:
        requested = {f'{year}-{month}-15T12:00:00+00:00' for month in item['request']['month']}
        if not requested or not requested <= expected:
            raise CampaignStop('Downloaded source exceeds approved dates')

        def record(date, measured):
            verify_snapshot(state, date)
            estimate(state, measured)
            checkpoint(state)

        source = path.with_suffix('.grib')
        publish(source, EXPECTED, complete_only=True, on_snapshot=record)
        if not requested <= reconcile(state):
            raise CampaignStop('Published date is missing from the production index')
        if year != PILOT_YEAR:
            write_manifest(path, item | {'state': 'published', 'published_timestamps': sorted(requested)})
            with refresh_owner('era5-import.lock') as owned:
                if owned and source.is_file() and sha256(source.read_bytes()).hexdigest() == item['source_sha256']:
                    source.unlink()


def run(state, deadline):
    stored = reconcile(state)
    SnapshotStorage().ensure_bucket()
    conflicts = provider_conflicts()
    for year in YEARS:
        if approved_dates(year) <= stored:
            continue
        if str(year) in conflicts:
            state['years'][str(year)] = {'state': 'review', 'reason': 'Matching CDS job absent from local manifests'}
            checkpoint(state)
            continue
        failures = 0
        while time.monotonic() < deadline:
            try:
                outcome = download(year, months=months(year))
                state['years'][str(year)] = {key: outcome[key] for key in ('state', 'provider_state', 'job_id') if key in outcome}
                checkpoint(state)
                if outcome['state'] in ('downloaded', 'already_downloaded'):
                    publish_saved(year, state)
                    stored = reconcile(state)
                    if approved_dates(year) <= stored:
                        state['years'][str(year)]['state'] = 'published'
                        checkpoint(state)
                        print(f'{year}: published and verified ({len(stored)}/{len(APPROVED)})', flush=True)
                        break
                elif outcome['state'] == 'already_stored':
                    stored = reconcile(state)
                    break
                elif outcome['state'] == 'failed':
                    break
                failures = 0
            except ProviderDeferred:
                pass
            except RETRYABLE as error:
                failures += 1
                if failures >= 4:
                    state['years'][str(year)] = {'state': 'retry_limit', 'error': type(error).__name__}
                    checkpoint(state)
                    break
            except ValueError as error:
                # A capacity failure is campaign-wide. An invalid source must not halt unrelated years.
                if str(error) in ('Campaign requires complete ERA5 source fields and timestamps',
                        'Inspect saved job before any retry; automatic resubmission prohibited',
                        'Unreviewed CDS result host', 'Source size exceeds bound', 'Source contains no valid snapshots',
                        'Not final ERA5 ECMWF reanalysis', 'Mismatched/duplicate validity time',
                        'CDS download manifest/integrity required', 'Unexpected variable', 'Unexpected message count'):
                    state['years'][str(year)] = {'state': 'review', 'reason': str(error)}
                    checkpoint(state)
                    break
                raise
            budget_sleep(deadline)
        else:
            break
    final_dates = reconcile(state)
    state['status'] = 'complete' if final_dates == APPROVED else 'incomplete'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-target', required=True, choices=[EXPECTED])
    parser.add_argument('--hours', type=float, default=36)
    args = parser.parse_args()
    if not 0 < args.hours <= 48:
        parser.error('--hours must be between zero and 48')
    logging.disable(logging.CRITICAL)
    with refresh_owner('era5-campaign.lock') as owned:
        if not owned:
            raise SystemExit('ERA5 campaign already running')
        state = json.loads(CHECKPOINT.read_text(encoding='utf8')) if CHECKPOINT.exists() else {
            'approved_count':len(APPROVED), 'verified':{}, 'sizes':{}, 'years':{},
        }
        state.pop('stop_reason', None)
        state['status'] = 'running'
        checkpoint(state)
        try:
            run(state, time.monotonic()+args.hours*3600)
        except Exception as error:
            state['status'] = 'stopped'
            safe_reasons = {'Storage reserve at risk', 'Storage usage cannot be established',
                'Measured database capacity is insufficient for this bounded batch', 'Local pilot quota/disk limit'}
            state['stop_reason'] = str(error) if isinstance(error, CampaignStop) or str(error) in safe_reasons else type(error).__name__
            checkpoint(state)
            print(f"ERA5 campaign stopped: {state['stop_reason']}", flush=True)
            raise SystemExit(1) from None
        checkpoint(state)
        print(f"ERA5 campaign {state['status']}: {len(state['verified'])}/{len(APPROVED)}", flush=True)
        if state['status'] != 'complete':
            raise SystemExit(2)


if __name__ == '__main__':
    main()
