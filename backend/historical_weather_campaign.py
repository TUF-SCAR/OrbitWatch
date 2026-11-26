"""Sequential, resumable publication of the approved seasonal ERA5 archive."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
import logging
import math
from pathlib import Path
import shutil
import time

import httpx
from requests import RequestException
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from historical_weather_import import (
    BUCKET, EXPECTED, OPEN_MANIFEST, capacity, download_batch, manifests, measurement,
    publish, target, write_manifest,
)
from services.era5_source import DATASET, MAX_BATCH_YEARS, QUARTERS, request_timestamps
from services.historical_capacity import require_capacity, storage_snapshot
from services.historical_weather_codec import SPECS
from services.historical_weather_storage import WeatherStorageUnavailable
from services.providers.budget import ROOT, ProviderDeferred, budget, refresh_owner

PRIORITIES = (2000, 1970, 1980, 1990, 2010, 2020)
YEARS = (*PRIORITIES, *(year for year in range(1970, 2027) if year not in PRIORITIES))
CHECKPOINT = ROOT / 'era5-campaign' / 'progress.json'
DB_QUOTA = 500_000_000
STORAGE_QUOTA = 1_000_000_000
PILOT_YEAR = 2024
CONTINUE_EXIT = 75
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


def next_request(stored, saved):
    """Recover existing work before proposing any new, nonoverlapping dates."""
    ready, outstanding, used_years, claimed_dates = [], [], set(), set()
    for path, item in saved:
        if item.get('dataset') != DATASET:
            continue
        dates = {date.isoformat() for date in request_timestamps(item['request'])}
        years = tuple(int(year) for year in item['request']['year'])
        status = item.get('state')
        if not dates <= APPROVED or claimed_dates & dates:
            raise CampaignStop('Saved CDS requests overlap or exceed the approved archive')
        claimed_dates.update(dates)
        used_years.update(years)
        if status == 'submission_uncertain':
            raise CampaignStop('CDS submission needs reconciliation before any new request')
        if status in OPEN_MANIFEST:
            outstanding.append((years, item['request']['month']))
        elif status == 'downloaded':
            if years != (PILOT_YEAR,) or not dates <= stored:
                ready.append((years, item['request']['month'], path, item))
        elif status not in {'published', 'failed'} or not dates <= stored:
            raise CampaignStop('A terminal saved CDS job has dates missing from production')
    if len(outstanding) > 1:
        raise CampaignStop('Multiple saved CDS requests require reconciliation')
    if ready:
        return (*ready[0][:2], ready[0][2:])
    if outstanding:
        return (*outstanding[0], None)

    pending = [year for year in YEARS if not approved_dates(year) <= stored]
    if not pending:
        return None
    first = pending[0]
    full_years = [year for year in pending if year != 2026 and year not in used_years
                  and not approved_dates(year) & stored]
    if first in full_years:
        return (tuple(full_years[:MAX_BATCH_YEARS]), QUARTERS, None)
    return ((first,), [month for month in months(first)
                       if f'{first}-{month}-15T12:00:00+00:00' not in stored], None)


def budget_sleep(deadline):
    with budget.connect() as db:
        row = db.execute("SELECT next_at,blocked FROM budgets WHERE name='cds-era5'").fetchone()
    if row and row[1]:
        raise CampaignStop('CDS authorization or rate-limit circuit needs review')
    delay = max(5, row[0]-time.time()) if row else 10
    time.sleep(max(0, min(delay, 240, deadline-time.monotonic())))


def publish_saved(path, item, state):
    requested = {date.isoformat() for date in request_timestamps(item['request'])}
    if not requested <= APPROVED:
        raise CampaignStop('Downloaded source exceeds approved dates')

    def record(date, measured):
        verify_snapshot(state, date)
        estimate(state, measured)
        checkpoint(state)

    source = path.with_suffix('.grib')
    start = time.monotonic()
    cpu_start = time.process_time()
    result = publish(source, EXPECTED, complete_only=True, on_snapshot=record)
    stored = reconcile(state)
    if not requested <= stored:
        raise CampaignStop('Published date is missing from the production index')
    years = [int(year) for year in item['request']['year']]
    metrics = {key: item[key] for key in ('provider_times', 'transfer_seconds', 'source_bytes',
                'downloaded_at', 'success_observed_at') if key in item}
    if Path('/proc/self/status').exists():
        peak = next((line.split()[1] for line in Path('/proc/self/status').read_text().splitlines()
                     if line.startswith('VmHWM:')), None)
        if peak:
            metrics['process_peak_rss_kib'] = int(peak)
    timestamps = {}
    for name, value in metrics.get('provider_times', {}).items():
        try:
            timestamps[name] = datetime.fromisoformat(value)
        except (TypeError, ValueError):
            continue
    timestamps = {name: date if date.tzinfo else date.replace(tzinfo=timezone.utc)
                  for name,date in timestamps.items()}
    for name, first, last in (('queue_seconds', 'created', 'started'),
                              ('execution_seconds', 'started', 'finished')):
        if first in timestamps and last in timestamps and timestamps[first] <= timestamps[last]:
            metrics[name] = round((timestamps[last] - timestamps[first]).total_seconds(), 3)
    metrics.update(years=years, verified_snapshots=len(requested),
                   validation_seconds=result['validation_seconds'],
                   validation_publish_verify_seconds=round(time.monotonic()-start, 3),
                   decoder_publisher_cpu_seconds=round(time.process_time()-cpu_start, 3))
    state.setdefault('batches', {})[item['job_id']] = metrics
    for year in years:
        state['years'][str(year)] = {'state': 'published' if approved_dates(year) <= stored else 'partial',
                                    'provider_state': 'successful', 'job_id': item['job_id']}
    checkpoint(state)
    if years != [PILOT_YEAR]:
        write_manifest(path, item | {'state': 'published', 'published_timestamps': sorted(requested)})
        with refresh_owner('era5-import.lock') as owned:
            if owned and source.is_file() and sha256(source.read_bytes()).hexdigest() == item['source_sha256']:
                source.unlink()
    print(f'{years}: published and verified ({len(stored)}/{len(APPROVED)})', flush=True)
    return stored


def run(state, deadline):
    stored = reconcile(state)
    failures = 0
    while time.monotonic() < deadline:
        plan = next_request(stored, manifests())
        if plan is None:
            state['status'] = 'complete'
            return
        years, selected_months, ready = plan
        state['current_years'] = list(years)
        needs_wait = True
        try:
            if ready:
                stored = publish_saved(*ready, state)
                needs_wait = False
            else:
                outcome = download_batch(years, months=selected_months)
                for year in years:
                    state['years'][str(year)] = {key: outcome[key] for key in
                                                ('state', 'provider_state', 'job_id') if key in outcome}
                if outcome['state'] == 'failed':
                    raise CampaignStop('CDS returned a terminal failure for a saved job')
                if outcome['state'] == 'already_stored':
                    stored = reconcile(state)
                needs_wait = outcome['state'] not in {'downloaded', 'already_stored'}
                checkpoint(state)
            failures = 0
        except ProviderDeferred:
            pass
        except RETRYABLE as error:
            failures += 1
            if failures >= 4:
                raise CampaignStop(f'Four consecutive production retries failed ({type(error).__name__})') from None
        if needs_wait:
            budget_sleep(deadline)
    state['status'] = 'continuing'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-target', required=True, choices=[EXPECTED])
    parser.add_argument('--hours', type=float, default=36)
    parser.add_argument('--resume-stopped', action='store_true')
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
        if state.get('status') == 'stopped' and not args.resume_stopped:
            raise SystemExit('ERA5 campaign requires review before resuming a safety stop')
        state.pop('stop_reason', None)
        state['status'] = 'running'
        checkpoint(state)
        try:
            run(state, time.monotonic()+args.hours*3600)
        except Exception as error:
            state['status'] = 'stopped'
            safe_reasons = {'Storage reserve at risk', 'Storage usage cannot be established',
                'Measured database capacity is insufficient for this bounded batch', 'Local pilot quota/disk limit'}
            safe_local = isinstance(error, ValueError) and error.__traceback__.tb_next
            while safe_local and safe_local.tb_next:
                safe_local = safe_local.tb_next
            if safe_local:
                safe_local = Path(safe_local.tb_frame.f_code.co_filename).name in {
                    'historical_weather_import.py', 'era5_source.py', 'historical_weather_codec.py'}
            state['stop_reason'] = str(error) if isinstance(error, CampaignStop) or safe_local or str(error) in safe_reasons else type(error).__name__
            checkpoint(state)
            print(f"ERA5 campaign stopped: {state['stop_reason']}", flush=True)
            raise SystemExit(1) from None
        checkpoint(state)
        print(f"ERA5 campaign {state['status']}: {len(state['verified'])}/{len(APPROVED)}", flush=True)
        if state['status'] == 'continuing':
            raise SystemExit(CONTINUE_EXIT)


if __name__ == '__main__':
    main()
