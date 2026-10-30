"""Explicit, retrieve-once Space-Track archives. Never called by an API route."""
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from services.historical_catalog import check_historical_ids
from services.providers import spacetrack
from services.providers.budget import ROOT, budget, refresh_owner

ARCHIVE_ROOT = ROOT / 'history'
MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
MAX_ARCHIVE_RECORDS = 5000


def utc(value):
    result = datetime.fromisoformat(str(value).replace('Z', '+00:00')) if not isinstance(value, datetime) else value
    if result.tzinfo is None:
        raise ValueError('Timestamp must include a UTC offset')
    return result.astimezone(timezone.utc)


def download_history(norad_ids, start, end, root=ARCHIVE_ROOT):
    ids = sorted(check_historical_ids(norad_ids))
    start, end = utc(start), utc(end)
    if not 0 < (end - start).total_seconds() <= 7 * 86400 or end > datetime.now(timezone.utc):
        raise ValueError('Archive windows must be in the past and at most seven days')
    query = (f'/basicspacedata/query/class/gp_history/NORAD_CAT_ID/{",".join(map(str, ids))}'
             f'/EPOCH/{start.strftime("%Y-%m-%dT%H:%M:%S")}--{end.strftime("%Y-%m-%dT%H:%M:%S")}'
             f'/orderby/NORAD_CAT_ID,EPOCH/limit/{MAX_ARCHIVE_RECORDS + 1}/format/json')
    key = hashlib.sha256(query.encode()).hexdigest()[:24]
    root = Path(root); root.mkdir(parents=True, exist_ok=True)
    manifest_path, archive_path = root / f'{key}.json', root / f'{key}.json.gz'
    with refresh_owner('historical-download.lock') as owned:
        if not owned:
            raise RuntimeError('Another historical download is running')
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text())
            if manifest['state'] == 'complete' and archive_path.exists():
                return manifest, archive_path
            if manifest.get('query_started', True):
                raise RuntimeError('This archive request was already attempted; inspect its saved status before any retry')
        for path in root.glob('*.json'):
            if path == manifest_path:
                continue
            saved = json.loads(path.read_text())
            if set(ids).intersection(saved['norad_ids']) and utc(saved['start']) < end and utc(saved['end']) > start:
                raise ValueError('Archive interval overlaps a prior request; reuse the saved archive')
        if sum(path.stat().st_size for path in root.glob('*.gz')) + MAX_ARCHIVE_BYTES > 50 * 1024 * 1024:
            raise ValueError('Historical archive pilot storage budget is full; do not expand it automatically')
        manifest = dict(source='Space-Track GP_HISTORY', query=query, norad_ids=ids,
                        start=start.isoformat(), end=end.isoformat(), state='reserved',
                        retrieved_at=datetime.now(timezone.utc).isoformat(), query_started=False)
        # Reserve provider quota before recording an attempted network request.
        with budget.attempt('spacetrack-history', 60, 2):
            manifest_path.write_text(json.dumps(manifest, indent=2))
            try:
                client = spacetrack.create_spacetrack_client()
                try:
                    manifest['query_started'] = True
                    manifest_path.write_text(json.dumps(manifest, indent=2))
                    with client.stream('GET', query) as response:
                        response.raise_for_status()
                        chunks, size = [], 0
                        for chunk in response.iter_bytes():
                            size += len(chunk)
                            if size > MAX_ARCHIVE_BYTES:
                                raise ValueError('Historical response exceeds the bounded archive size')
                            chunks.append(chunk)
                finally:
                    client.close()
                raw = b''.join(chunks)
                # Keep the original response, even if validation later rejects it.
                compressed = gzip.compress(raw, mtime=0)
                archive_path.write_bytes(compressed)
                manifest.update(raw_bytes=len(raw), compressed_bytes=len(compressed), sha256=hashlib.sha256(raw).hexdigest())
                records = json.loads(raw)
                if not isinstance(records, list) or len(records) > MAX_ARCHIVE_RECORDS:
                    raise ValueError('Archive response is invalid or truncated; use a smaller disjoint interval')
                for record in records:
                    if int(record['NORAD_CAT_ID']) not in ids:
                        raise ValueError('Archive returned an unsupported satellite')
                    # Space-Track OMM epochs are UTC even when the offset is omitted.
                    epoch = utc(record['EPOCH'] + 'Z' if not str(record['EPOCH']).endswith('Z') and '+' not in str(record['EPOCH']) else record['EPOCH'])
                    if not start <= epoch <= end:
                        raise ValueError('Archive returned an epoch outside the requested interval')
                manifest.update(state='complete', records=len(records))
            except Exception as error:
                manifest.update(state='failed', error_type=type(error).__name__)
                raise
            finally:
                manifest_path.write_text(json.dumps(manifest, indent=2))
    return manifest, archive_path


def archive_records(path):
    path = Path(path)
    with gzip.open(path, 'rb') as archive:
        raw = archive.read(MAX_ARCHIVE_BYTES + 1)
    if len(raw) > MAX_ARCHIVE_BYTES:
        raise ValueError('Archive exceeds the import size bound')
    records = json.loads(raw)
    if not isinstance(records, list) or len(records) > MAX_ARCHIVE_RECORDS:
        raise ValueError('Archive exceeds the record count bound')
    return records
