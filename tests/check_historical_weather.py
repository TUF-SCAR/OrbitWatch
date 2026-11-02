"""Isolated ERA5 scientific contract/API tests. NO production writes/downloads."""
import gzip
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import nullcontext
from datetime import datetime,timezone
from unittest.mock import patch
import numpy as np

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'backend'))
# Import routes without loading deployment credentials or touching a real DB.
os.environ['DATABASE_URL']='sqlite://'
os.environ['JWT_SECRET_KEY']='isolated-weather-test-key'
from services.historical_weather_codec import *
from services.era5_source import canonical_grid,request_for_year,read_grib,PARAMS,VARIABLES
from services.historical_weather_storage import SnapshotStorage,WeatherStorageUnavailable

STAMP=datetime(1945,1,15,12,tzinfo=timezone.utc)
PROVENANCE=dict(dataset=DATASET,product='reanalysis',source_sha256='a'*64,job_id='ISOLATED-SCIENTIFIC-FIXTURE')


def fixture_fields():
    return {name:np.full(NODES,{'temperature':20,'dewpoint':10,'clouds':50,'precipitation':2,'pressure':1013,'u':3,'v':4,'humidity':52.5}[name],dtype=float) for name in SPECS}


def grib_fixture(path,bad=None):
    import eccodes as ec
    with path.open('wb') as stream:
        for param,(name,unit,level_type,level) in PARAMS.items():
            h=ec.codes_grib_new_from_samples('regular_ll_sfc_grib1')
            try:
                for key,value in {'Ni':360,'Nj':181,'latitudeOfFirstGridPointInDegrees':90,'latitudeOfLastGridPointInDegrees':-90,'longitudeOfFirstGridPointInDegrees':0,'longitudeOfLastGridPointInDegrees':359,'iDirectionIncrementInDegrees':1,'jDirectionIncrementInDegrees':1,'paramId':param,'dataDate':19450115,'dataTime':1200,'marsClass':'ea','marsStream':'oper'}.items(): ec.codes_set(h,key,value)
                if name=='precipitation':
                    ec.codes_set(h,'dataType','fc');ec.codes_set(h,'dataTime',600);ec.codes_set(h,'stepType','accum');ec.codes_set(h,'startStep',5);ec.codes_set(h,'endStep',6)
                if name==bad: ec.codes_set(h,'typeOfLevel','heightAboveGround');ec.codes_set(h,'level',999)
                values={'temperature':293.15,'dewpoint':283.15,'clouds':.5,'precipitation':.002,'pressure':101300,'u':3,'v':4}
                ec.codes_set_values(h,np.full(NODES,values[name]));ec.codes_write(h,stream)
            finally:ec.codes_release(h)
    return dict(dataset=DATASET,state='downloaded',source_sha256=sha256(path.read_bytes()).hexdigest(),job_id='ISOLATED-SCIENTIFIC-FIXTURE',request=dict(year=['1945'],month=['01'],product_type=['reanalysis'],time=['12:00'],day=['15'],variable=VARIABLES,grid=[1,1]))


class ScientificWeather(unittest.TestCase):
    def test_calendar_exact_328_and_source_backextension(self):
        dates=seasonal_dates();self.assertEqual(len(set(dates)),328)
        self.assertEqual(dates[0],STAMP);self.assertEqual(dates[-1].isoformat(),'2026-10-15T12:00:00+00:00')
        self.assertEqual(request_for_year(1945)['month'],['01','04','07','10'])
        for date in ['1944-01-15T12:00:00Z','1945-01-15T12:00:01Z','1945-02-15T12:00:00Z','2099-01-15T12:00:00Z','1945-01-15T12:00:00']:
            with self.assertRaises(ValueError):check_seasonal(date)
        self.assertEqual(request_for_year(2026,datetime(2026,11,2,tzinfo=timezone.utc))['month'],['01','04','07'])
    def test_conversions_and_humidity(self):
        self.assertAlmostEqual(convert('temperature',[273.15])[0],0)
        self.assertEqual(convert('pressure',[101325])[0],1013.25)
        self.assertEqual(convert('clouds',[.5])[0],50)
        self.assertEqual(convert('precipitation',[.0015])[0],1.5)
        self.assertAlmostEqual(relative_humidity(293.15,293.15),100)
        self.assertAlmostEqual(relative_humidity(293.15,283.15),52.50,delta=.05)
        self.assertAlmostEqual(math.hypot(3,4)*3.6,18)
    def test_roundtrip_masks_quantization_and_corruption(self):
        fields=fixture_fields();fields['temperature'][0]=np.nan;fields['temperature'][10]=20.006
        blob,h=encode(STAMP,fields,PROVENANCE);header,decoded=decode(blob,sha256(blob).hexdigest())
        self.assertLess(len(blob),MAX_BLOB);self.assertTrue(np.isnan(decoded['temperature'][0]));self.assertAlmostEqual(decoded['temperature'][10],20.01)
        self.assertEqual(header['fields']['temperature']['missing_nodes'],1)
        for bad in [blob[:-10],blob+b'garbage',b'corrupt',zlib.compress(b'x'*(MAX_RAW+1))]:
            with self.assertRaises((ValueError,zlib.error)):decode(bad)
        with self.assertRaises(ValueError):decode(blob,'b'*64)
        fields['pressure'][0]=2000
        with self.assertRaises(ValueError):encode(STAMP,fields,PROVENANCE)
    def test_wrap_poles_and_missing_corners(self):
        a=np.tile(np.arange(360,dtype=float),181)
        self.assertEqual(sample(a,90,-180),sample(a,90,180));self.assertEqual(sample(a,-90,-180),0)
        a[1]=np.nan
        self.assertIsNone(sample(a,90,-179.5));self.assertEqual(sample(a,90,-180),0)
        with self.assertRaises(ValueError):sample(a,91,0)
    def test_downsampling_order_and_antimeridian(self):
        lat=np.repeat(np.arange(90,-90.1,-.25),1440);lon=np.tile(np.arange(0,360,.25),721)
        values=lat+lon/1000
        a=canonical_grid(lat,lon,values)
        self.assertAlmostEqual(a[0],90.18);self.assertAlmostEqual(a[180],90)
        self.assertAlmostEqual(a[-360],-89.82)
        lon[0]=lon[1]
        with self.assertRaises(ValueError):canonical_grid(lat,lon,values)
    def test_grib_scientific_metadata_and_partial_isolation(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'fixture.grib';manifest=grib_fixture(path)
            result=read_grib(path,manifest)[STAMP]
            self.assertEqual(set(result['fields']),set(SPECS))
            self.assertAlmostEqual(result['fields']['precipitation'][0],2,places=4)
            self.assertAlmostEqual(result['fields']['temperature'][0],20,delta=.0002)
            bad={**manifest,'source_sha256':'b'*64}
            with self.assertRaises(ValueError):read_grib(path,bad)
            manifest=grib_fixture(path,'clouds');result=read_grib(path,manifest)[STAMP]
            self.assertNotIn('clouds',result['fields']);self.assertIn('temperature',result['fields'])
            self.assertIn('clouds',result['failures'])
    def test_storage_integrity_and_limits(self):
        store=object.__new__(SnapshotStorage);blob,h=encode(STAMP,fixture_fields(),PROVENANCE)
        key=f'era5/v1/19450115T120000Z/{sha256(blob).hexdigest()}.owwx'
        with patch.object(store,'get',side_effect=[WeatherStorageUnavailable(),blob]),patch.object(store,'request') as upload:
            store.put_verified(key,blob);self.assertEqual(upload.call_count,1)
        with patch.object(store,'get',return_value=b'corrupt'):
            with self.assertRaises(ValueError):store.put_verified(key,blob)
        with self.assertRaises(ValueError):store.put_verified('../elsewhere',blob)
    def test_capacity_reserves(self):
        from historical_weather_import import capacity
        capacity({'database_bytes':14_000_000,'storage':{'bytes':0}})
        for m in [{'database_bytes':299_000_000,'storage':{'bytes':0}},{'database_bytes':14_000_000,'storage':{'bytes':749_000_000}}]:
            with self.assertRaises(ValueError):capacity(m)
    def test_cds_grouping_resume_and_no_duplicate_submission(self):
        from unittest.mock import Mock
        import historical_weather_import as importer
        with tempfile.TemporaryDirectory() as temp,patch.object(importer,'ARCHIVE',Path(temp)),patch.object(importer,'cds_settings',return_value=('https://cds.climate.copernicus.eu/api','ISOLATED')),patch.object(importer,'refresh_owner',return_value=nullcontext(True)),patch.object(importer.budget,'attempt',side_effect=lambda *args:nullcontext()),patch('ecmwf.datastores.Client') as client:
            remote=Mock(request_id='ISOLATED-JOB',status='accepted',results_ready=False)
            client.return_value.submit.return_value=remote;client.return_value.get_remote.return_value=remote
            a=importer.download(1945);b=importer.download(1945)
            self.assertEqual(a['job_id'],b['job_id']);self.assertEqual(client.return_value.submit.call_count,1)
            self.assertEqual(client.return_value.get_remote.call_count,1)
            self.assertEqual(a['request']['month'],['01','04','07','10'])
            manifest=next(Path(temp).glob('*.json'));value=json.loads(manifest.read_text(encoding='utf8'));value['state']='submission_uncertain';manifest.write_text(json.dumps(value),encoding='utf8')
            with self.assertRaises(ValueError):importer.download(1945)
            self.assertEqual(client.return_value.submit.call_count,1)


class HistoricalWeatherAPI(unittest.TestCase):
    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from routes.historical_weather import router
        from core.security import get_current_user
        self.auth=get_current_user;self.app=FastAPI();self.app.include_router(router);self.client=TestClient(self.app)
    def test_auth_and_exact_gating(self):
        self.assertEqual(self.client.get('/api/historical/weather/coverage').status_code,401)
        self.app.dependency_overrides[self.auth]=lambda:object()
        with patch('services.historical_weather.rows',return_value=[]),patch('services.historical_weather.SnapshotStorage') as storage:
            c=self.client.get('/api/historical/weather/coverage');self.assertEqual(c.json()['stored_count'],0);self.assertEqual(c.json()['planned_count'],328)
            for endpoint in ['snapshot','location']:
                suffix='&latitude=0&longitude=0' if endpoint=='location' else ''
                self.assertEqual(self.client.get('/api/historical/weather/'+endpoint+'?timestamp=1945-01-16T12:00:00Z'+suffix).status_code,404)
            storage.assert_not_called()
        self.assertEqual(self.client.get('/api/historical/weather/snapshot?timestamp=2099-01-15T12:00:00Z').status_code,422)
    def test_api_planes_location_and_storage_failure(self):
        from services import historical_weather as archive
        blob,h=encode(STAMP,fixture_fields(),PROVENANCE)
        row=dict(timestamp=STAMP,version=1,provider=PROVIDER,dataset=DATASET,product='reanalysis',variables=h['fields'],grid=GRID,object_key='unused',sha256=sha256(blob).hexdigest(),compressed_bytes=len(blob),status='complete',validated_at=STAMP,provenance=PROVENANCE)
        self.app.dependency_overrides[self.auth]=lambda:object()
        with patch.object(archive,'rows',return_value=[row]),patch.object(archive,'load_object',return_value=decode(blob)):
            r=self.client.get('/api/historical/weather/snapshot?timestamp=1945-01-15T12:00:00Z');self.assertEqual(r.status_code,200);self.assertEqual(r.json()['fields']['temperature']['values'][0],20)
            r=self.client.get('/api/historical/weather/location?timestamp=1945-01-15T12:00:00Z&latitude=90&longitude=180');self.assertEqual(r.json()['values']['wind_speed'],18)
            self.assertEqual(r.json()['precipitation_period_seconds'],3600)
        with patch.object(archive,'rows',return_value=[row]),patch.object(archive,'load_object',side_effect=WeatherStorageUnavailable()):
            self.assertEqual(self.client.get('/api/historical/weather/snapshot?timestamp=1945-01-15T12:00:00Z').status_code,503)
        self.assertEqual(self.client.get('/api/historical/weather/location?timestamp=1945-01-15T12:00:00Z&latitude=91&longitude=0').status_code,422)


if __name__=='__main__':unittest.main()
