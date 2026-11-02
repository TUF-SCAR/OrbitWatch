"""Stored-only historical weather. No source downloads or Live weather fallback."""
from datetime import datetime, timezone
from functools import lru_cache
import math
from sqlalchemy import text
from core.database import database_engine
from services.historical_weather_codec import DATASET, PROVIDER, GRID, SPECS, utc, decode, sample
from services.historical_weather_storage import SnapshotStorage, WeatherStorageUnavailable


def rows(timestamp=None):
    # PostgreSQL contains metadata only. A maximum of 512 published timestamps.
    with database_engine.connect() as connection:
        return [dict(row) for row in connection.execute(text('''SELECT DISTINCT ON (timestamp) *
            FROM historical_weather_snapshots WHERE timestamp<=now()
            AND (CAST(:timestamp AS timestamptz) IS NULL OR timestamp=CAST(:timestamp AS timestamptz))
            ORDER BY timestamp,version DESC LIMIT 512'''), {'timestamp':timestamp.isoformat() if timestamp else None}).mappings()]


def public_metadata(row):
    return {key:row[key] for key in ('timestamp','version','provider','dataset','product','variables','grid','sha256','compressed_bytes','status','validated_at','provenance')}


def coverage():
    records=rows()
    return dict(provider=PROVIDER,dataset=DATASET,planned_count=328,stored_count=len(records),
        available_years=sorted({row['timestamp'].year for row in records}),
        last_validated_import=max((row['validated_at'] for row in records),default=None),
        snapshots=[public_metadata(row) for row in records],
        policy='Exact stored UTC timestamps only. No closest-date substitution or temporal interpolation.')


@lru_cache(maxsize=4)
def load_object(key,checksum):
    return decode(SnapshotStorage().get(key),checksum)


def snapshot(timestamp):
    date=utc(timestamp); records=rows(date)
    if not records: return None
    row=records[0]
    header,arrays=load_object(row['object_key'],row['sha256'])
    if utc(header['timestamp'])!=date or header['fields']!=row['variables'] or header['grid']!=row['grid']:
        raise ValueError('Stored index and object mismatch')
    # Only validated planes; JSON null is an explicit per-node missing mask.
    fields={key:{'units':SPECS[key][0],'values':[float(v) if math.isfinite(v) else None for v in a]} for key,a in arrays.items()}
    return dict(metadata=public_metadata(row),timestamp=date.isoformat(),grid=GRID,fields=fields,
                precipitation_period_seconds=3600,source='ERA5 reanalysis')


def location(timestamp,latitude,longitude):
    date=utc(timestamp); records=rows(date)
    if not records: return None
    row=records[0]; header,arrays=load_object(row['object_key'],row['sha256'])
    if utc(header['timestamp'])!=date or header['fields']!=row['variables'] or header['grid']!=row['grid']: raise ValueError('Stored index mismatch')
    values={name:sample(a,latitude,longitude) for name,a in arrays.items()}
    if values.get('u') is not None and values.get('v') is not None: values['wind_speed']=math.hypot(values['u'],values['v'])*3.6
    return dict(timestamp=date.isoformat(),latitude=latitude,longitude=longitude,values=values,
                units={**{key:spec[0] for key,spec in SPECS.items()},'wind_speed':'km/h'},
                source='ERA5 reanalysis',grid=GRID,precipitation_period_seconds=3600,
                provenance=row['provenance'],status=row['status'])
