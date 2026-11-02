"""ERA5 display codec v1: zlib(header JSON + little-endian int16 planes).

1-degree POINT samples at integer coordinates, north to south, west=-180.
No temporal interpolation; spatial bilinear sampling preserves missing corners.
Resolution reduction adds no physical detail. Quantization error <= scale/2.
RH is over liquid water: ECMWF IFS Tetens es=611.21 exp(17.502*(T-273.16)/(T-32.19)).
https://confluence.ecmwf.int/spaces/CKB/pages/76414402/ERA5+data+documentation
"""
from datetime import datetime, timezone, timedelta
from hashlib import sha256
import json
import math
import re
import struct
import zlib
import numpy as np

DATASET = 'reanalysis-era5-single-levels'
PROVIDER = 'Copernicus CDS / ECMWF'
SOURCE_URL = 'https://cds.climate.copernicus.eu/datasets/' + DATASET
GRID = dict(width=360, height=181, west=-180, north=90, step=1, sampling='point')
NODES = 360 * 181
MAX_BLOB = 4 * 1024 * 1024
MAX_RAW = 2 * 1024 * 1024
MISSING = -32768
# Unit, quantization scale, accepted physical range (after conversion).
SPECS = {
    'temperature': ('°C', .01, -133.15, 86.85),
    'dewpoint': ('°C', .01, -153.15, 66.85),
    'clouds': ('%', .01, 0, 100),
    'precipitation': ('mm', .01, 0, 300),
    'pressure': ('hPa', .1, 800, 1200),
    'u': ('m/s', .01, -150, 150), 'v': ('m/s', .01, -150, 150),
    'humidity': ('%', .01, 0, 100),
}


def utc(value):
    date = datetime.fromisoformat(str(value).replace('Z', '+00:00')) if not isinstance(value, datetime) else value
    if date.tzinfo is None: raise ValueError('UTC offset required')
    date = date.astimezone(timezone.utc)
    if date < datetime(1945, 1, 1, tzinfo=timezone.utc) or date > datetime.now(timezone.utc):
        raise ValueError('Historical timestamp outside supported range')
    return date


def seasonal_dates():
    return [datetime(year, month, 15, 12, tzinfo=timezone.utc) for year in range(1945, 2027) for month in (1, 4, 7, 10)]


def check_seasonal(value):
    date = utc(value)
    if date not in seasonal_dates(): raise ValueError('Expected January/April/July/October 15 at exactly 12:00 UTC')
    return date


def relative_humidity(temperature_k, dewpoint_k):
    t, d = np.asarray(temperature_k, dtype=float), np.asarray(dewpoint_k, dtype=float)
    return np.clip(100 * np.exp(17.502 * ((d-273.16)/(d-32.19) - (t-273.16)/(t-32.19))), 0, 100)


def convert(name, values):
    a = np.array(values, dtype=float, copy=True)
    if name in ('temperature', 'dewpoint'): a -= 273.15
    elif name == 'clouds': a *= 100
    elif name == 'pressure': a /= 100
    elif name == 'precipitation': a *= 1000
    return a


def encode(timestamp, fields, provenance):
    date = utc(timestamp)
    if not fields or not set(fields).issubset(SPECS): raise ValueError('No supported fields')
    if provenance.get('dataset') != DATASET or provenance.get('product') != 'reanalysis' or not re.fullmatch('[a-f0-9]{64}',provenance.get('source_sha256','')):
        raise ValueError('Missing source provenance')
    header = dict(format='OWWX1', timestamp=date.isoformat(), dataset=DATASET, product='reanalysis',
                  provider=PROVIDER, grid=GRID, fields={}, provenance=provenance,
                  precipitation_period_seconds=3600, missing=MISSING, byte_order='little')
    planes = []
    for name in sorted(fields):
        unit, scale, low, high = SPECS[name]
        a = np.asarray(fields[name], dtype=float).reshape(-1)
        if a.size != NODES or np.any(np.isinf(a)): raise ValueError('Invalid plane')
        valid = np.isfinite(a)
        if not valid.any() or np.any(a[valid] < low-1e-6) or np.any(a[valid] > high+1e-6): raise ValueError('Implausible plane')
        # Pressure has an explicit offset to fit int16 without sacrificing precision.
        offset = 1000 if name == 'pressure' else 0
        q = np.full(NODES, MISSING, dtype='<i2')
        q[valid] = np.rint((a[valid]-offset)/scale).astype('<i2')
        header['fields'][name] = dict(units=unit, scale=scale, offset=offset, missing_nodes=int((~valid).sum()))
        planes.append(q.tobytes())
    h = json.dumps(header, separators=(',', ':'), allow_nan=False).encode('utf8')
    if len(h) > 32768: raise ValueError('Header too large')
    blob = zlib.compress(b'OWWX1' + struct.pack('<I', len(h)) + h + b''.join(planes), 9)
    if len(blob) > MAX_BLOB: raise ValueError('Snapshot exceeds bound')
    return blob, header


def decode(blob, checksum=None):
    try: return _decode(blob,checksum)
    except (zlib.error,struct.error,KeyError,TypeError,OverflowError,AttributeError):
        raise ValueError('Corrupt snapshot encoding') from None


def _decode(blob, checksum=None):
    if not 0 < len(blob) <= MAX_BLOB or checksum and sha256(blob).hexdigest() != checksum: raise ValueError('Snapshot checksum failed')
    inflater = zlib.decompressobj()
    raw = inflater.decompress(blob, MAX_RAW+1)
    if len(raw) > MAX_RAW or not inflater.eof or inflater.unused_data or inflater.unconsumed_tail or raw[:5] != b'OWWX1': raise ValueError('Corrupt snapshot')
    size = struct.unpack('<I', raw[5:9])[0]
    if not 0 < size <= 32768: raise ValueError('Invalid header')
    header = json.loads(raw[9:9+size])
    if not isinstance(header,dict): raise ValueError('Invalid header')
    if header.get('format') != 'OWWX1' or header.get('dataset') != DATASET or header.get('provider') != PROVIDER or header.get('product') != 'reanalysis' or header.get('grid') != GRID or header.get('byte_order') != 'little' or header.get('missing') != MISSING or header.get('precipitation_period_seconds') != 3600 or not re.fullmatch('[a-f0-9]{64}',header.get('provenance',{}).get('source_sha256','')):
        raise ValueError('Unsupported snapshot')
    utc(header['timestamp'])
    fields = header.get('fields', {})
    if not isinstance(fields,dict) or not fields or not set(fields).issubset(SPECS) or len(raw) != 9+size+len(fields)*NODES*2: raise ValueError('Invalid planes')
    arrays = {}
    for index, (name, spec) in enumerate(fields.items()):
        unit, scale, low, high = SPECS[name]
        offset = 1000 if name == 'pressure' else 0
        if spec.get('units') != unit or spec.get('scale') != scale or spec.get('offset') != offset: raise ValueError('Invalid encoding')
        q = np.frombuffer(raw, dtype='<i2', count=NODES, offset=9+size+index*NODES*2)
        a = q.astype(float)*scale+offset; a[q == MISSING] = np.nan
        if int(np.isnan(a).sum()) != spec.get('missing_nodes') or not np.isfinite(a).any() or np.any(a < low-.006) or np.any(a > high+.006): raise ValueError('Invalid values')
        arrays[name] = a
    return header, arrays


def sample(values, latitude, longitude):
    if not math.isfinite(latitude) or not math.isfinite(longitude) or abs(latitude) > 90 or abs(longitude) > 180: raise ValueError('Invalid coordinates')
    x, y = (longitude+180) % 360, 90-latitude
    ix, iy = math.floor(x), math.floor(y)
    result = 0
    for xx, yy, w in ((ix, iy, (1-x%1)*(1-y%1)), ((ix+1)%360, iy, x%1*(1-y%1)), (ix, min(180, iy+1), (1-x%1)*(y%1)), ((ix+1)%360, min(180, iy+1), (x%1)*(y%1))):
        if not w: continue
        a = values[yy*360+xx]
        if not math.isfinite(a): return None
        result += float(a)*w
    return result
