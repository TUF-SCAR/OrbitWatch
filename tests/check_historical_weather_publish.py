"""Migration/publish transaction verification in a named disposable local DB."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from unittest.mock import patch
import psycopg
from sqlalchemy import create_engine,text

ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'tests')]
os.environ['DATABASE_URL']='sqlite://'
from check_historical_weather import grib_fixture
from historical_weather_import import publish
from services.historical_weather_storage import SnapshotStorage,WeatherStorageUnavailable


def main():
    # Fixed loopback port and unique disposable name; never reads .env target.
    with psycopg.connect(host='127.0.0.1',port=55444,user='orbitwatch_test',dbname='postgres',autocommit=True,connect_timeout=3) as db:
        db.execute('DROP DATABASE IF EXISTS orbitwatch_weather_import_test WITH (FORCE)')
        db.execute('CREATE DATABASE orbitwatch_weather_import_test')
    engine=create_engine('postgresql+psycopg://orbitwatch_test@127.0.0.1:55444/orbitwatch_weather_import_test')
    try:
        sql=re.sub(r'(?m)^BEGIN;\s*$|^COMMIT;\s*$','',(ROOT/'backend/migrations/006_historical_weather.sql').read_text(encoding='utf8'))
        with engine.begin() as db:
            db.exec_driver_sql('CREATE TABLE users(id integer); CREATE TABLE satellite_historical_elements(id integer); CREATE SCHEMA storage; CREATE TABLE storage.objects(metadata jsonb)')
            db.exec_driver_sql(sql);db.exec_driver_sql(sql)
            assert db.scalar(text("SELECT relrowsecurity FROM pg_class WHERE oid='historical_weather_snapshots'::regclass"))
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'fixture.grib';manifest=grib_fixture(path)
            path.with_suffix('.json').write_text(json.dumps(manifest),encoding='utf8')
            store=object.__new__(SnapshotStorage)
            store.ensure_bucket=lambda:None
            with patch('historical_weather_import.target',return_value=(engine,'ISOLATED')):
                with patch.object(store,'get',side_effect=[WeatherStorageUnavailable(),b'corrupt']),patch.object(store,'request'):
                    try:publish(path,'ISOLATED',store);raise AssertionError('Corrupt upload published')
                    except ValueError:pass
                with engine.connect() as db:assert db.scalar(text('SELECT count(*) FROM historical_weather_snapshots'))==0
                objects={}
                def request(method,path,**kwargs):
                    if method=='POST':objects[path.split('historical-weather/')[1]]=kwargs['content'];return b'{}'
                    raise AssertionError('Unexpected Storage operation')
                def get(key):
                    if key not in objects:raise WeatherStorageUnavailable()
                    return objects[key]
                with patch.object(store,'get',side_effect=get),patch.object(store,'request',side_effect=request):
                    result=publish(path,'ISOLATED',store);assert result['inserted']==1
                    result=publish(path,'ISOLATED',store);assert result['inserted']==0
                    assert len(objects)==1
                with engine.connect() as db:
                    row=db.execute(text('SELECT * FROM historical_weather_snapshots')).mappings().one()
                    assert row['status']=='complete' and len(row['variables'])==8
                    assert row['compressed_bytes']==len(objects[row['object_key']])
                    assert db.scalar(text('SELECT count(*) FROM users'))==0
            manifest['source_sha256']='b'*64;path.with_suffix('.json').write_text(json.dumps(manifest),encoding='utf8')
            with patch('historical_weather_import.target') as target:
                try:publish(path,'ISOLATED',store);raise AssertionError('Corrupt source published')
                except ValueError:pass
                target.assert_not_called()
        print('PASS: migration twice/RLS; corrupt source and object rejected before metadata; upload-before-publish; complete variables; duplicate import no-op; unrelated rows unchanged')
    finally:
        engine.dispose()
        with psycopg.connect(host='127.0.0.1',port=55444,user='orbitwatch_test',dbname='postgres',autocommit=True,connect_timeout=3) as db:
            db.execute('DROP DATABASE orbitwatch_weather_import_test WITH (FORCE)')


if __name__=='__main__':main()
