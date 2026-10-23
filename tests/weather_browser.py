"""Loopback-only real App API, temporary accounts/TLEs, genuine recorded weather.

--fetch-real explicitly makes TWO public HTTP requests: one filtered NOAA field
and one three-location Open-Meteo contract. Normal --serve makes zero external
weather/orbital requests. Never reads .env or production database/credentials.
"""
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
from datetime import datetime,timezone
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))


def run():
    output=ROOT/'.orbitwatch-backups/weather'
    with tempfile.TemporaryDirectory(dir=ROOT/'.orbitwatch-backups') as tmp,patch('dotenv.load_dotenv',return_value=False),patch.dict(os.environ,{
        'DATABASE_URL':f'sqlite:///{Path(tmp).as_posix()}/browser.db','JWT_SECRET_KEY':secrets.token_hex(32),
        'ORBITWATCH_INGESTION_ENABLED':'false','ORBITWATCH_WEATHER_PROVIDER_REQUESTS':'false',
        'ORBITWATCH_WEATHER_CACHE_DIR':str(output/'browser-cache'),'CORS_ALLOWED_ORIGINS':'http://127.0.0.1:5175'}):
        from services import weather as w
        from core.database import DatabaseBase,database_engine,database_session_maker
        from models.user import User
        from models.satellite_orbital_data import SatelliteOrbitalData
        from services.auth import hash_password
        from main import app
        DatabaseBase.metadata.create_all(database_engine)
        now=datetime.now(timezone.utc);epoch=now.strftime('%y')+f"{int(now.strftime('%j'))+(now.hour*3600+now.minute*60+now.second)/86400:012.8f}"
        with database_session_maker() as session:
            session.add(User(username='weather_test',email='weather@example.invalid',password_hash=hash_password('OrbitWatch-weather-test')))
            for index,ident in enumerate([25544,20580,48274,39084,58990,26407]):
                session.add(SatelliteOrbitalData(norad_id=ident,object_name=f'SYNTHETIC BROWSER TLE {ident}',epoch=now,
                    tle_line1=f'1 {ident:05d}U 98067A   {epoch}  .00000000  00000-0  00000-0 0  9990',
                    tle_line2=f'2 {ident:05d}  51.6400 {index*50:8.4f} 0005000  40.0000  80.0000 15.50000000123450',source='SYNTHETIC BROWSER TLE',fetched_at=now))
            session.commit()
        if '--fetch-real' in sys.argv:
            with patch.dict(os.environ,{'ORBITWATCH_WEATHER_PROVIDER_REQUESTS':'true'}):
                field=w.refresh_global()
                w.cache.reserve('open_meteo')
                data=json.loads(w.download('https://api.open-meteo.com/v1/forecast',{'latitude':'17.4,51.5,-33.9','longitude':'78.5,-0.1,151.2','models':'gfs_global','current':w.CURRENT_VARIABLES,'temperature_unit':'celsius','wind_speed_unit':'ms','precipitation_unit':'mm','timeformat':'unixtime','timezone':'GMT','forecast_days':1},100000))
                retrieved=w.utcnow()
                for row,(lat,lon) in zip(data,[(17.4,78.5),(51.5,-.1),(-33.9,151.2)]):
                    w.cache.put(w.location_key(lat,lon),'location',w.parse_location(row,lat,lon,retrieved))
                (output/'final-real-global.json').write_text(json.dumps(field),encoding='utf-8')
                (output/'final-real-locations.json').write_text(json.dumps(data),encoding='utf-8')
                (output/'final-real-contract.json').write_text(json.dumps({'noaa_requests':1,'open_meteo_requests':1,'location_equivalent_calls':3,'at':w.iso(retrieved),'field_id':field['id'],'valid_at':field['valid_at'],'source_file':field['source_file']},indent=2))
                print('PASS real production NOAA download/decode/cache + Open-Meteo3-location contract; HTTP2')
        if '--serve' in sys.argv:
            if not w.cache.latest_global(): raise RuntimeError('No real weather cache; run --fetch-real once first')
            import uvicorn
            print('Isolated real API8001: weather_test / OrbitWatch-weather-test; real recorded weather, synthetic TLE/account; external providers disabled')
            try: uvicorn.run(app,host='127.0.0.1',port=8001,lifespan='off')
            finally: w.executor.shutdown(wait=True);database_engine.dispose()
        else: w.executor.shutdown(wait=True);database_engine.dispose()


if __name__=='__main__':run()
