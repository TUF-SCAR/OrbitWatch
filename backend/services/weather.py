from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import logging
import math
import threading
import httpx
from core.config import enabled
from core.database import database_availability
from services.weather_cache import WeatherCache, WeatherDeferred
from services.weather_grid import decode_temperature, iso

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
            for chunk in response.iter_bytes():
                length += len(chunk)
                if length > limit: raise ValueError('Weather response exceeds limit')
                chunks.append(chunk)
            return b''.join(chunks)


def refresh_global():
    cycle, step, file = target()
    with cache.lease() as owned:
        if not owned: raise WeatherDeferred()
        existing = cache.latest_global()
        if existing and existing['source_file'] == f'{cycle:%Y%m%d}/{file}': return existing
        database_availability.ensure()
        if not enabled('ORBITWATCH_WEATHER_PROVIDER_REQUESTS', True): raise WeatherDeferred()
        cache.reserve('noaa')
        try:
            data = download('https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl',
                {'file':file,'lev_2_m_above_ground':'on','var_TMP':'on','dir':f'/gfs.{cycle:%Y%m%d}/{cycle:%H}/atmos',
                 'leftlon':0,'rightlon':360,'toplat':90,'bottomlat':-90}, 2000000)
            field = decode_temperature(data, f'{cycle:%Y%m%d}/{file}', utcnow())
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
        if pending is None or pending.done():
            pending = executor.submit(refresh_global)
            # Consume failures; no unhandled Future or unbounded queued jobs.
            pending.add_done_callback(lambda future: future.exception())


def global_temperature():
    field = annotate(cache.latest_global(), 'global')
    if field:
        cycle, step, file = target()
        if field['source_file'] != f'{cycle:%Y%m%d}/{file}':
            revalidate_global(); field = {**field, 'state':'stale', 'refresh_pending':True}
        return field
    return annotate(refresh_global(), 'global')


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
    field = annotate(cache.latest_global(),'global')
    return {'state':field['state'] if field else 'unavailable',
            'temperature':{key:field[key] for key in ('id','valid_at','retrieved_at','resolution_degrees')} if field else None,
            'provider_gates':cache.status(), 'providers_enabled':enabled('ORBITWATCH_WEATHER_PROVIDER_REQUESTS',True)}
