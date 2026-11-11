"""Independent provider leases and protected disabled IR routes; no upstream IO."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from datetime import datetime,timezone
import json
import os
import sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'backend'))
with patch('dotenv.load_dotenv',return_value=False),patch.dict(os.environ,{
    'DATABASE_URL':'sqlite:///:memory:','JWT_SECRET_KEY':'isolated-weather-test-key-not-used-in-production',
    'ORBITWATCH_INFRARED_ENABLED':'false','ORBITWATCH_INFRARED_LICENSE_CONFIRMED':'false',
    'ORBITWATCH_WEATHER_PROVIDER_REQUESTS':'true','ORBITWATCH_INGESTION_ENABLED':'false'}):
    from services import weather as w
    from services.weather_cache import WeatherCache
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes.weather import router
    from core.security import get_current_user
    from services.infrared import infrared
    now=datetime.now(timezone.utc)
    point=dict(latitude=0,longitude=0,current=dict(time=now.timestamp(),interval=900,temperature_2m=0,wind_speed_10m=0,is_day=0),
               current_units=dict(temperature_2m='°C',wind_speed_10m='m/s',is_day=''))
    with TemporaryDirectory(dir=ROOT/'.setup-cache') as tmp,patch.object(w,'cache',WeatherCache(tmp)),patch.object(w.database_availability,'ensure'),patch.object(w,'download',return_value=json.dumps(point).encode()) as download:
        with w.cache.lease('noaa') as noaa:
            assert noaa
            result=w.location_weather(0,0)
            assert result['values']['temperature_2m']==0 and result['values']['is_day']==0
        assert download.call_count==1
        with w.cache.lease('open_meteo') as local:
            with w.cache.lease('noaa') as noaa: assert local and noaa
        for day,units,expected in [(1,'',1),(0,'',0),(None,'',None),(4,'',None),(float('nan'),'',None),(1,'hours',None)]:
            raw={**point,'current':{**point['current'],'is_day':day},'current_units':{**point['current_units'],'is_day':units}}
            assert w.parse_location(raw,0,0,now)['values']['is_day']==expected
    app=FastAPI();app.include_router(router)
    with TestClient(app) as client,patch.object(infrared,'retrieve',side_effect=AssertionError('Disabled feature must not fetch')):
        for url in ['/api/weather/infrared/slots','/api/weather/infrared/frame?time=2026-11-11T00:00:00Z']:
            assert client.get(url).status_code==401
        app.dependency_overrides[get_current_user]=lambda:object()
        for url in ['/api/weather/infrared/slots','/api/weather/infrared/frame?time=2026-11-11T00:00:00Z']:
            response=client.get(url);assert response.status_code==503 and response.headers['cache-control']=='no-store'
    w.executor.shutdown(wait=True,cancel_futures=True)
print('PASS Open-Meteo succeeds during NOAA lease; zero/provider/missing day flag contracts; IR auth and disabled503; HTTP0')
