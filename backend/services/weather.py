from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import logging
import math
import threading
import time
import httpx
from core.config import enabled
from core.database import database_availability
from services.weather_cache import WeatherCache, WeatherDeferred
from services.weather_grid import decode_temperature, iso
from services.weather_fields import decode_fields

cache = WeatherCache()
logger = logging.getLogger('orbitwatch.weather')
CURRENT_VARIABLES = 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover,weather_code'
# Lazily used only after a weather request, never on API startup/status reads.
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='weather')
pending_lock = threading.Lock()
pending = None


def utcnow(): return datetime.now(timezone.utc)
def timestamp(value): return datetime.fromisoformat(value.replace('Z','+00:00'))


def annotate(value, kind):
    if not value: return None
    now = utcnow(); age = max(0, (now-timestamp(value['retrieved_at'])).total_seconds())
    valid_age = (now-timestamp(value['valid_at'])).total_seconds()
    # A stale forecast is still a forecast for its original valid time, never a
    # present-day observation. Hard expiry prevents displaying ancient weather.
    if valid_age > (86400 if kind == 'global' else 10800) or valid_age < -10800: return None
    stale = age > (21600 if kind == 'global' else 900) or valid_age > (21600 if kind == 'global' else 1800)
    return {**value, 'cache_age_seconds': round(age), 'valid_age_seconds': round(valid_age), 'state': 'stale' if stale else 'available'}


def target(now=None):
    now = now or utcnow(); delayed = now-timedelta(hours=6)
    cycle = delayed.replace(hour=delayed.hour//6*6, minute=0, second=0, microsecond=0)
    step = int((now-cycle).total_seconds()//10800)*3
    file = f'gfs.t{cycle:%H}z.pgrb2.1p00.f{step:03d}'
    return cycle, step, file


def download(url, params, limit):
    # No redirects/retries: each real HTTP request has a persistent reservation.
    with httpx.Client(timeout=httpx.Timeout(20, connect=5), follow_redirects=False) as client:
        with client.stream('GET', url, params=params) as response:
            response.raise_for_status()
            if response.status_code != 200: raise ValueError('Unexpected provider status')
            chunks=[]; length=0
            started = time.monotonic()
            for chunk in response.iter_bytes():
                if time.monotonic()-started > 45: raise TimeoutError('Weather download deadline')
                length += len(chunk)
                if length > limit: raise ValueError('Weather response exceeds limit')
                chunks.append(chunk)
            return b''.join(chunks)


def refresh_global():
    cycle, step, file = target()
    with cache.lease() as owned:
        if not owned: raise WeatherDeferred()
        existing = cache.latest_global()
        if existing and existing.get('fields') and existing['source_file'] == f'{cycle:%Y%m%d}/{file}': return existing
        database_availability.ensure()
        if not enabled('ORBITWATCH_WEATHER_PROVIDER_REQUESTS', True): raise WeatherDeferred()
        # Check our local decoder before spending an upstream reservation.
        try:
            from eccodes import codes_get_api_version
            codes_get_api_version()
        except Exception:
            cache.record('noaa', 'unavailable', 'decoder_unavailable')
            raise WeatherDeferred() from None
        cache.reserve('noaa')
        try:
            cache.record('noaa', 'downloading')
            data = download('https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl',
                {'file':file,'lev_2_m_above_ground':'on','lev_10_m_above_ground':'on','lev_surface':'on',
                 'lev_entire_atmosphere':'on','var_TMP':'on','var_TCDC':'on','var_PRATE':'on','var_UGRD':'on','var_VGRD':'on',
                 'dir':f'/gfs.{cycle:%Y%m%d}/{cycle:%H}/atmos',
                 'leftlon':0,'rightlon':360,'toplat':90,'bottomlat':-90}, 16000000)
            cache.record('noaa', 'decoding')
            field = decode_fields(data, f'{cycle:%Y%m%d}/{file}', utcnow())
            if timestamp(field['model_initialized_at']) != cycle or timestamp(field['valid_at']) != cycle+timedelta(hours=step):
                raise ValueError('Source time differs from requested forecast')
            cache.put(field['id'], 'global', field); cache.succeeded('noaa')
            return field
        except Exception as error:
            cache.failed('noaa',error)
            logger.warning('Global weather deferred (%s)',type(error).__name__)
            raise WeatherDeferred() from None


def revalidate_global():
    global pending
    with pending_lock:
        if (pending is None or pending.done()) and cache.gate('noaa')['retry_after_seconds'] == 0 and enabled('ORBITWATCH_WEATHER_PROVIDER_REQUESTS', True):
            pending = executor.submit(refresh_global)
            # Consume failures; no unhandled Future or unbounded queued jobs.
            pending.add_done_callback(lambda future: future.exception())


def global_availability(raw=None):
    """Small safe status, no HTTP. A persisted phase requires a live OS lease."""
    field = annotate(raw, 'global')
    gate, event = cache.gate('noaa'), cache.event('noaa')
    active = pending is not None and not pending.done()
    with cache.lease() as free:
        shared_active = not free
    phase = event['phase'] if event else None
    if active or shared_active:
        state = phase if phase in {'downloading', 'decoding'} else 'preparing'
        retry = 3
    elif not enabled('ORBITWATCH_WEATHER_PROVIDER_REQUESTS', True):
        state, retry = 'unavailable', 300
    elif gate['retry_after_seconds']:
        state, retry = 'cooldown', gate['retry_after_seconds']
    elif phase == 'unavailable':
        state, retry = 'unavailable', 300
    elif gate['failures']:
        state, retry = 'failed', 5
    elif field:
        state, retry = 'available', 600
    else:
        state, retry = 'unavailable', 5
    failure = None
    if gate['failures'] or phase == 'unavailable':
        failure = {'category': (event or {}).get('category') or 'unknown_prior_failure',
                   'http_status': (event or {}).get('http_status'), 'count': gate['failures']}
    return {'state': state, 'has_field': field is not None,
            'data_state': field['state'] if field else 'hard_expired' if raw else 'empty',
            'retry_after_seconds': retry, 'next_attempt_at': iso(utcnow()+timedelta(seconds=retry)),
            'last_failure': failure, 'providers_enabled': enabled('ORBITWATCH_WEATHER_PROVIDER_REQUESTS', True)}


def global_temperature(require_fields=False):
    raw = cache.latest_global()
    field = annotate(raw, 'global')
    cycle, step, file = target()
    needs_refresh = not field or field['source_file'] != f'{cycle:%Y%m%d}/{file}' or (require_fields and not field.get('fields'))
    if needs_refresh: revalidate_global()
    availability = global_availability(raw)
    if not field:
        field = annotate(cache.latest_global(), 'global')
        if field:
            needs_refresh = field['source_file'] != f'{cycle:%Y%m%d}/{file}'
            availability = global_availability(field)
    if field:
        return {**field, 'state': 'stale' if needs_refresh else field['state'],
                'refresh_pending': availability['state'] in {'preparing','downloading','decoding'},
                'availability': availability}
    # Cold requests never wait for network/GRIB work. Poll only when advised.
    return availability


def coordinates(latitude, longitude):
    if not math.isfinite(latitude) or not math.isfinite(longitude) or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError('Invalid weather coordinates')
    lat=round(latitude,1);lon=round((longitude+180)%360-180,1)
    if lon==180:lon=-180.0
    return lat or 0.0, lon or 0.0


def location_key(latitude, longitude):
    latitude,longitude=coordinates(latitude,longitude)
    return f'point:{latitude:.1f}:{longitude:.1f}'


def parse_location(data, latitude, longitude, retrieved_at):
    current, units = data['current'], data['current_units']
    if not isinstance(current.get('time'), (int,float)) or units.get('temperature_2m') != '°C' or units.get('wind_speed_10m') != 'm/s':
        raise ValueError('Unexpected location weather schema/units')
    values = {}
    for variable in CURRENT_VARIABLES.split(','):
        value = current.get(variable)
        if value is not None and (not isinstance(value,(int,float)) or not math.isfinite(value)): raise ValueError('Invalid weather value')
        values[variable] = value
    if not 0 < current.get('interval',0) <= 3600: raise ValueError('Invalid weather interval')
    return {'provider':'Open-Meteo', 'model':'GFS Global (Open-Meteo processing)', 'kind':'current_model',
            'model_initialized_at':None, 'valid_at':iso(datetime.fromtimestamp(current['time'],timezone.utc)),
            'retrieved_at':iso(retrieved_at), 'interval_seconds':current['interval'],
            'requested_latitude':latitude, 'requested_longitude':longitude,
            'grid_latitude':data['latitude'],'grid_longitude':data['longitude'],
            'values':values,'units':{key:units.get(key) for key in values},
            'attribution':'Open-Meteo · NOAA GFS · CC BY 4.0', 'source_url':'https://open-meteo.com/'}


def location_weather(latitude, longitude):
    latitude,longitude=coordinates(latitude,longitude); key=location_key(latitude,longitude)
    cached = annotate(cache.get(key),'location')
    if cached and cached['cache_age_seconds'] < 900: return cached
    try:
        with cache.lease() as owned:
            if not owned: raise WeatherDeferred()
            # Recheck after taking the cross-process lease.
            latest = annotate(cache.get(key),'location')
            if latest and latest['cache_age_seconds'] < 900: return latest
            database_availability.ensure()
            if not enabled('ORBITWATCH_WEATHER_PROVIDER_REQUESTS', True): raise WeatherDeferred()
            cache.reserve('open_meteo')
            try:
                import json
                data = json.loads(download('https://api.open-meteo.com/v1/forecast',
                    {'latitude':latitude,'longitude':longitude,'models':'gfs_global','current':CURRENT_VARIABLES,
                     'temperature_unit':'celsius','wind_speed_unit':'ms','precipitation_unit':'mm',
                     'timeformat':'unixtime','timezone':'GMT','forecast_days':1}, 100000))
                value = parse_location(data,latitude,longitude,utcnow())
                if annotate(value,'location') is None: raise ValueError('Location valid time is unavailable')
                cache.put(key,'location',value); cache.succeeded('open_meteo')
                return annotate(value,'location')
            except Exception as error:
                cache.failed('open_meteo',error)
                logger.warning('Location weather deferred (%s)',type(error).__name__)
                raise WeatherDeferred() from None
    except WeatherDeferred:
        if cached: return {**cached,'state':'stale','provider_unavailable':True}
        raise


def weather_status():
    raw = cache.latest_global();field = annotate(raw,'global')
    return {'state':field['state'] if field else 'unavailable',
            'temperature':{key:field[key] for key in ('id','valid_at','retrieved_at','resolution_degrees')} if field else None,
            'provider_gates':cache.status(), 'availability': global_availability(raw),
            'providers_enabled':enabled('ORBITWATCH_WEATHER_PROVIDER_REQUESTS',True)}
