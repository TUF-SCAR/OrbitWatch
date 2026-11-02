"""Bounded browser fixture, fixed local DB only; authentic cached archive rows.

Never loads .env, never connects production, never fetches upstream providers.
"""
import gzip
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch
import psycopg

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'backend'))


def main():
    with psycopg.connect(host='127.0.0.1',port=55444,user='orbitwatch_test',dbname='postgres',connect_timeout=3,autocommit=True) as db:
        db.execute('DROP DATABASE IF EXISTS orbitwatch_time_ui WITH (FORCE)');db.execute('CREATE DATABASE orbitwatch_time_ui')
    with patch('dotenv.load_dotenv',return_value=False),patch.dict(os.environ,{'DATABASE_URL':'postgresql+psycopg://orbitwatch_test@127.0.0.1:55444/orbitwatch_time_ui',
        'JWT_SECRET_KEY':'isolated-time-browser-fixture-key-never-production','ORBITWATCH_INGESTION_ENABLED':'false','ORBITWATCH_WEATHER_PROVIDER_REQUESTS':'false',
        'ORBITWATCH_EVENT_PROVIDER_REQUESTS':'false','CORS_ALLOWED_ORIGINS':'http://127.0.0.1:5174'}):
        from sqlalchemy.orm import Session
        from core.database import DatabaseBase,database_engine
        from models.historical_elements import HistoricalElements
        from services.historical_tracker import normalize_elements
        from main import app
        from fastapi.testclient import TestClient
        import uvicorn
        DatabaseBase.metadata.create_all(database_engine)
        fixture=TestClient(app)
        response=fixture.post('/api/auth/register',json={'username':'time_fixture','email':'time@example.invalid','password':'Disposable-time-2026'})
        assert response.status_code==201
        saved=set()
        with Session(database_engine) as db:
            for path in (ROOT/'backend/.runtime/history').glob('*.json.gz'):
                records=json.loads(gzip.decompress(path.read_bytes()))
                for record in records:
                    identity=int(record.get('NORAD_CAT_ID',0))
                    if identity in saved or identity not in (20580,25544):continue
                    row=normalize_elements(record)
                    db.add(HistoricalElements(**row));saved.add(identity)
                    print('Authentic fixture epoch:',identity,row['epoch'].isoformat(),flush=True)
                if len(saved)==2:break
            db.commit()
        async def isolated(scope,receive,send):
            if scope['type']=='http' and (scope['path'].startswith('/api/weather') or scope['path'].startswith('/api/events')):
                from starlette.responses import JSONResponse
                return await JSONResponse({'detail':'External providers disabled in isolated Time browser fixture'},503)(scope,receive,send)
            return await app(scope,receive,send)
        print('Disposable UI: time_fixture / Disposable-time-2026',flush=True)
        try:uvicorn.run(isolated,host='127.0.0.1',port=8001,log_level='warning')
        finally:fixture.close();database_engine.dispose()


if __name__=='__main__':main()
