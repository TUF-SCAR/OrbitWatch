import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nearestWeatherMetadata,historicalField,validateHistoricalSnapshot,hasHistoricalVariable} from '../src/services/historicalWeather.js';
import {weatherPixels} from '../src/services/weatherFields.js';
const timestamp='1945-01-15T12:00:00Z';
const published=(timestamp,overrides={})=>({timestamp,provider:'Copernicus CDS / ECMWF',dataset:'reanalysis-era5-single-levels',
  product:'reanalysis',status:'complete',sha256:'a'.repeat(64),validated_at:'2024-01-15T12:00:00Z',...overrides});
function fixture(){return {timestamp,source:'ERA5 reanalysis',precipitation_period_seconds:3600,grid:{width:360,height:181,west:-180,north:90,step:1},metadata:{timestamp,sha256:'a'.repeat(64),dataset:'reanalysis-era5-single-levels',product:'reanalysis',variables:{temperature:{},u:{},v:{}}},fields:{temperature:{units:'°C',values:Array(65160).fill(20)},precipitation:{units:'mm',values:Array(65160).fill(2)},u:{units:'m/s',values:Array(65160).fill(3)},v:{units:'m/s',values:Array(65160).fill(4)}}};}
test('nearest search spans the archive and prefers exact or earlier ties',()=>{
  const october=published('1945-10-15T12:00:00Z'),january=published('1946-01-15T12:00:00Z');
  const coverage={snapshots:[january,october,published(timestamp)]};
  const nearest=time=>nearestWeatherMetadata(coverage,time)?.timestamp;
  assert.equal(nearest(january.timestamp),january.timestamp);
  assert.equal(nearest('1945-01-16'),timestamp);
  assert.equal(nearest('1944-01-01'),timestamp);
  assert.equal(nearest('1946-12-31'),january.timestamp);
  assert.equal(nearest('1945-12-31'),january.timestamp);
  const midpoint=(Date.parse(october.timestamp)+Date.parse(january.timestamp))/2;
  assert.equal(nearest(midpoint),october.timestamp);
  assert.equal(nearest(midpoint+1),january.timestamp);
  assert.equal(nearestWeatherMetadata({snapshots:[]},timestamp),null);
  assert.equal(nearestWeatherMetadata(coverage,'invalid'),null);
});
test('new genuine publications join the search and unvalidated rows are excluded',()=>{
  const one=published(timestamp),two=published('1945-04-15T12:00:00Z',{status:'partial'});
  const instant='1945-04-14T12:00:00Z';
  const candidates=[one,published(instant,{status:'draft'}),published(instant,{validated_at:null}),
    published(instant,{sha256:'not-a-hash'}),published(instant,{provider:'GFS'}),published('2099-01-15T12:00:00Z')];
  assert.equal(nearestWeatherMetadata({snapshots:candidates},instant),one);
  assert.equal(nearestWeatherMetadata({snapshots:[...candidates,two]},instant),two);
});
test('historical contract preserves units, source, masks and independent U/V',()=>{
  const s=fixture();validateHistoricalSnapshot(s,timestamp);
  const rain=historicalField(s,'precipitation'),wind=historicalField(s,'wind');
  assert.equal(rain.units,'mm');assert.equal(rain.source_kind,'era5');assert.equal(wind.units,'m/s');assert.equal(wind.u[0],3);
  assert.ok(hasHistoricalVariable(s.metadata,'wind'));assert.equal(historicalField(s,'humidity'),null);
  assert.equal(weatherPixels(rain,4,2).length,32);
  s.fields.precipitation.values[0]=null;assert.doesNotThrow(()=>validateHistoricalSnapshot(s,timestamp));
  assert.throws(()=>validateHistoricalSnapshot(s,'1945-01-16T12:00:00Z'));
  assert.throws(()=>validateHistoricalSnapshot(s,timestamp,'b'.repeat(64)));
  s.fields.precipitation.units='mm/h';assert.throws(()=>validateHistoricalSnapshot(s,timestamp));
});
test('archive fetches and attribution use the resolved source while the scene stays independent',()=>{
  const hook=fs.readFileSync(new URL('../src/utils/useHistoricalWeather.js',import.meta.url),'utf8');
  assert.match(hook,/cacheHit=sourceKey!==null&&stored\?\.key===sourceKey/);
  assert.match(hook,/cacheHit\?stored\.value:null/);assert.match(hook,/controller\.abort\(\)/);
  assert.match(hook,/fetchHistoricalWeatherLocation\(new Date\(sourceStamp\)/);
  const panel=fs.readFileSync(new URL('../src/components/HistoricalWeatherPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/Nearest available snapshot/);assert.match(panel,/Precipitation during the preceding hour/);
  assert.doesNotMatch(panel,/onNearest|loadSceneTime/);
  assert.match(panel,/names only/);assert.doesNotMatch(panel,/Open-Meteo|NATURAL EVENTS|GFS/);
});
