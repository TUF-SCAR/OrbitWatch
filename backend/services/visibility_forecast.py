"""Hourly future weather, sharing the existing Open-Meteo quota and host lease."""
from datetime import datetime, timezone
import json
import math
import time
import httpx
from core.config import enabled
from services.weather import cache, coordinates
from services.weather_cache import WeatherDeferred


def forecast(latitude, longitude, max_age_seconds=3600):
    lat, lon = coordinates(latitude, longitude)
    key = f'visibility:{lat}:{lon}'
    now = datetime.now(timezone.utc)
    def recent(value):
        return value and 0 <= now.timestamp()-value['retrieved_epoch'] < max(900,min(3600,max_age_seconds))
    value = cache.get(key)
    if recent(value):
        return value
    try:
        with cache.lease() as owned:
            if not owned or not enabled('ORBITWATCH_WEATHER_PROVIDER_REQUESTS', True):
                raise WeatherDeferred()
            value = cache.get(key)
            if recent(value):
                return value
            cache.reserve('open_meteo')  # Same 60/hour, 500/day budget as current weather.
            try:
                deadline=time.monotonic()+5
                with httpx.Client(timeout=httpx.Timeout(3, connect=2), follow_redirects=False) as client:
                    with client.stream('GET', 'https://api.open-meteo.com/v1/forecast', params={
                        'latitude':lat, 'longitude':lon, 'hourly':'cloud_cover,precipitation_probability,precipitation',
                        'forecast_days':3, 'timeformat':'unixtime', 'timezone':'GMT'}) as response:
                        response.raise_for_status()
                        chunks=[]; size=0
                        for chunk in response.iter_bytes():
                            if time.monotonic()>deadline: raise TimeoutError('Forecast deadline exceeded')
                            size += len(chunk)
                            if size > 60000: raise ValueError('Forecast too large')
                            chunks.append(chunk)
                data=json.loads(b''.join(chunks)); hourly=data['hourly']; units=data['hourly_units']
                if units.get('cloud_cover')!='%' or units.get('precipitation')!='mm' or units.get('precipitation_probability')!='%':
                    raise ValueError('Unexpected forecast units')
                rows=[]
                for stamp, cloud, probability, precipitation in zip(hourly['time'],hourly['cloud_cover'],hourly['precipitation_probability'],hourly['precipitation'], strict=True):
                    if len(rows)>=96: raise ValueError('Forecast too long')
                    if not all(isinstance(v,(float,int)) and math.isfinite(v) for v in (stamp,cloud,probability,precipitation)):
                        continue
                    if not 0<=cloud<=100 or not 0<=probability<=100 or precipitation<0: continue
                    rows.append({'valid_epoch':stamp,'cloud_cover_percent':cloud,'precipitation_probability_percent':probability,'precipitation_mm':precipitation})
                if not rows: raise ValueError('No usable forecast hours')
                value={'rows':rows,'retrieved_epoch':now.timestamp(),'retrieved_at':now.isoformat(),
                       'provider':'Open-Meteo','attribution':'Open-Meteo · CC BY 4.0','grid_latitude':data['latitude'],'grid_longitude':data['longitude']}
                cache.put(key,'visibility',value); cache.succeeded('open_meteo')
                return value
            except Exception as error:
                cache.failed('open_meteo',error)
                raise WeatherDeferred() from None
    except (WeatherDeferred, OSError):
        return None  # Never substitute old current weather or stale forecast datasets.


def match_forecast(dataset, moment, now=None):
    now = now or datetime.now(timezone.utc)
    if not dataset or not 0<=now.timestamp()-dataset['retrieved_epoch']<3600:
        return {'state':'unavailable','reason':'Weather forecast unavailable or stale'}
    row=min(dataset['rows'],key=lambda r:abs(r['valid_epoch']-moment.timestamp()),default=None)
    if not row or abs(row['valid_epoch']-moment.timestamp())>1800:
        return {'state':'unavailable','reason':'No forecast interval within 30 minutes'}
    return {'state':'available',**row,'valid_at':datetime.fromtimestamp(row['valid_epoch'],timezone.utc).isoformat(),
            'retrieved_at':dataset['retrieved_at'],'provider':dataset['provider'],'attribution':dataset['attribution'],
            'matching':'Nearest hourly timestamp, at most 30 minutes away',
            'conditions':'Cloudy / difficult' if row['cloud_cover_percent']>70 or row['precipitation_mm']>0 else 'Forecast may support viewing'}
