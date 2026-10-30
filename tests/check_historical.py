"""Historical contracts against an explicitly isolated loopback PostgreSQL DB.

Uses authentic saved archives if available. Never contacts orbital providers or
uses the configured production database. Test identities exist only locally.
"""
import gzip
import json
import math
import os
from pathlib import Path
import secrets
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
url = os.environ['HISTORICAL_TEST_DATABASE_URL']
assert make_url(url).host in ('127.0.0.1','localhost') and make_url(url).port == 55432, 'Use only the isolated historical test cluster'
os.environ.update(DATABASE_URL=url,JWT_SECRET_KEY=secrets.token_hex(32),ORBITWATCH_INGESTION_ENABLED='false')

from core.database import database_engine
from models.user import User
from models.satellite_orbital_data import SatelliteOrbitalData, SatelliteOrbitalDataHistory
from models.historical_elements import HistoricalElements
from services.historical_catalog import HISTORICAL_IDS, HISTORICAL_DEFAULT_IDS, check_historical_ids
from services.historical_archive import ARCHIVE_ROOT, download_history
from services.historical_tracker import normalize_elements, historical_propagator, historical_batch, _propagator
from services.satellite_tracker import satellite_cache, propagate_samples, timescale
from repositories.historical_elements import import_historical_records, historical_records
from historical_import import inspect_archive
from fastapi.testclient import TestClient


def run():
    assert len(HISTORICAL_IDS)==15 and len(set(HISTORICAL_IDS))==15
    assert HISTORICAL_DEFAULT_IDS==(25544,20580,48274,39084)
    try:check_historical_ids([58990]);raise AssertionError('Live-only satellite accepted')
    except ValueError:pass
    for table in (User.__table__,SatelliteOrbitalData.__table__,SatelliteOrbitalDataHistory.__table__):
        table.create(database_engine,checkfirst=True)
    sql=(ROOT/'backend/migrations/001_historical_elements.sql').read_text()
    for _ in range(2):
        with database_engine.connect() as connection:connection.exec_driver_sql(sql)
    with database_engine.connect() as connection:
        assert connection.scalar(text("SELECT relrowsecurity FROM pg_class WHERE oid='satellite_historical_elements'::regclass"))
        assert connection.scalar(text("SELECT count(*) FROM pg_indexes WHERE tablename='satellite_historical_elements'"))==2
    archives=list(ARCHIVE_ROOT.glob('*.json.gz'))
    assert archives, 'Run the explicit bounded download before authentic archive verification'
    values=[];reports=[];source_records=[]
    for archive in archives:
        rows,report=inspect_archive(archive);values.extend(rows);reports.append(report)
        source_records.extend(json.loads(gzip.decompress(archive.read_bytes())))
    assert set(row['norad_id'] for row in values)<=set(HISTORICAL_IDS)
    assert set(HISTORICAL_DEFAULT_IDS)<={row['norad_id'] for row in values}
    inserted=import_historical_records(values,database_engine)
    assert import_historical_records(values,database_engine)==0
    with database_engine.connect() as connection:
        count=connection.scalar(select(text('count(*)')).select_from(HistoricalElements))
        assert count==len({row['record_id'] for row in values})
    omm=next(record for record in source_records if int(record['NORAD_CAT_ID'])==25544)
    normalized=normalize_elements(omm);satellite=historical_propagator(normalized)
    tle={key:value for key,value in omm.items() if key not in ('MEAN_MOTION','ECCENTRICITY','INCLINATION','RA_OF_ASC_NODE','ARG_OF_PERICENTER','MEAN_ANOMALY','BSTAR','MEAN_MOTION_DOT','MEAN_MOTION_DDOT')}
    tle_satellite=historical_propagator(normalize_elements(tle))
    dates=[normalized['epoch']+timedelta(seconds=600)]
    a,b=propagate_samples(satellite,dates)[0],propagate_samples(tle_satellite,dates)[0]
    separation=math.dist(a['teme_position_km'],b['teme_position_km'])*1000
    assert separation<10, separation
    t=timescale.from_datetime(dates[0]);code,raw,_=satellite.model.sgp4(t.whole,t.ut1_fraction-t.dut1/86400)
    assert code==0 and math.dist(raw,a['teme_position_km'])<.01
    stamp=datetime(2024,6,2,16,tzinfo=timezone.utc)
    records=historical_records(list(HISTORICAL_IDS),stamp)
    assert all(row['epoch']<=stamp and (stamp-row['epoch']).total_seconds()<=86400 for row in records.values())
    before=dict(satellite_cache)
    with patch('services.providers.spacetrack.get_latest_gp',side_effect=AssertionError('Live provider called')),patch('services.historical_archive.download_history',side_effect=AssertionError('Archive downloaded by API')):
        batch=historical_batch(list(HISTORICAL_IDS),stamp)
        assert len(batch['objects'])==len(records), batch['errors']
        assert set(HISTORICAL_DEFAULT_IDS)<={item['norad_id'] for item in batch['objects']}
        assert satellite_cache==before and _propagator.cache_info().currsize<=128
        assert all(item['position']['timestamp']==stamp.isoformat() for item in batch['objects'])
        assert all(item['trajectory']['reference_frame']=='TEME' and item['orbit']['fixed_reference_frame']=='ITRS' for item in batch['objects'])
        assert any(item['orbit']['path_kind']=='arc' for item in batch['objects']), 'Slow orbit must be clipped to the age policy'
        assert len(historical_batch(list(HISTORICAL_IDS),datetime(1990,1,1,tzinfo=timezone.utc))['errors'])==15
        assert len(historical_batch(list(HISTORICAL_IDS),datetime(2035,1,1,tzinfo=timezone.utc))['errors'])==15
        from main import app
        with TestClient(app) as client:
            assert client.get('/api/historical/coverage').status_code==401
            suffix=secrets.token_hex(4)
            login=client.post('/api/auth/register',json={'username':'history_'+suffix,'email':suffix+'@example.invalid','password':'isolated-history-check'})
            assert login.status_code==201, login.text
            headers={'Authorization':'Bearer '+login.json()['access_token']}
            def request(method,path,expected=200,**kwargs):
                response=client.request(method,path,headers=headers,**kwargs)
                assert response.status_code==expected,(path,response.status_code,response.text[:180]);return response
            coverage=request('GET','/api/historical/coverage').json();assert len(coverage['objects'])==15
            body={'norad_ids':list(HISTORICAL_DEFAULT_IDS),'timestamp':stamp.isoformat()}
            response=request('POST','/api/historical/trajectories',json=body).json();assert len(response['objects'])==4
            request('GET','/api/historical/25544/position',params={'timestamp':stamp.isoformat()})
            request('GET','/api/historical/25867/orbit',params={'timestamp':stamp.isoformat()})
            request('POST','/api/historical/trajectories',422,json={**body,'norad_ids':[58990]})
            request('POST','/api/historical/trajectories',422,json={**body,'norad_ids':[25544]*16})
            request('POST','/api/historical/trajectories',422,json={**body,'timestamp':'2024-06-02T16:00:00'})
            request('POST','/api/historical/trajectories',422,json={**body,'duration_seconds':3600,'step_seconds':1})
            request('GET','/api/historical/25544/position',404,params={'timestamp':'1990-01-01T00:00:00Z'})
            # Missing historical table is a separate deployment state; Live
            # readiness/authentication must remain usable after this response.
            with database_engine.begin() as connection:connection.exec_driver_sql('ALTER TABLE satellite_historical_elements RENAME TO historical_test_saved')
            try:
                request('GET','/api/historical/coverage',503)
                assert client.get('/health/ready').status_code==200
            finally:
                with database_engine.begin() as connection:connection.exec_driver_sql('ALTER TABLE historical_test_saved RENAME TO satellite_historical_elements')
    with database_engine.connect() as connection:
        storage=dict(connection.execute(text("SELECT count(*) AS rows,round(avg(pg_column_size(h)))::int AS mean_row_bytes,pg_total_relation_size('satellite_historical_elements') AS table_and_indexes_bytes FROM satellite_historical_elements h")).mappings().one())
    print(json.dumps({'result':'PASS','archives':reports,'inserted':inserted,'storage':storage,'omm_tle_separation_metres':separation,'available_at_2024_06_02_16_utc':len(batch['objects']),'real_api_orbital_provider_requests':0},indent=2))


if __name__=='__main__':run()
