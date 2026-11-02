import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {exactWeatherMetadata,nearestWeatherMetadata,historicalField,validateHistoricalSnapshot,hasHistoricalVariable} from '../src/services/historicalWeather.js';
import {weatherPixels} from '../src/services/weatherFields.js';
const timestamp='1945-01-15T12:00:00Z';
function fixture(){return {timestamp,source:'ERA5 reanalysis',precipitation_period_seconds:3600,grid:{width:360,height:181,west:-180,north:90,step:1},metadata:{timestamp,sha256:'a'.repeat(64),dataset:'reanalysis-era5-single-levels',product:'reanalysis',variables:{temperature:{},u:{},v:{}}},fields:{temperature:{units:'°C',values:Array(65160).fill(20)},precipitation:{units:'mm',values:Array(65160).fill(2)},u:{units:'m/s',values:Array(65160).fill(3)},v:{units:'m/s',values:Array(65160).fill(4)}}};}
test('only exact timestamps match; nearest action is separate and deterministic',()=>{
  const coverage={snapshots:[{timestamp},{timestamp:'1945-04-15T12:00:00Z'}]};
  assert.ok(exactWeatherMetadata(coverage,timestamp));
  assert.equal(exactWeatherMetadata(coverage,'1945-01-15T12:00:01Z'),null);
  assert.equal(exactWeatherMetadata(coverage,'1945-01-16T12:00:00Z'),null);
  assert.equal(nearestWeatherMetadata(coverage,'1945-01-16').timestamp,timestamp);
  assert.equal(nearestWeatherMetadata({snapshots:[]},timestamp),null);
});
test('historical contract preserves units, source, masks and independent U/V',()=>{
  const s=fixture();validateHistoricalSnapshot(s,timestamp);
  const rain=historicalField(s,'precipitation'),wind=historicalField(s,'wind');
  assert.equal(rain.units,'mm');assert.equal(rain.source_kind,'era5');assert.equal(wind.units,'m/s');assert.equal(wind.u[0],3);
  assert.ok(hasHistoricalVariable(s.metadata,'wind'));assert.equal(historicalField(s,'humidity'),null);
  assert.equal(weatherPixels(rain,4,2).length,32);
  s.fields.precipitation.values[0]=null;assert.doesNotThrow(()=>validateHistoricalSnapshot(s,timestamp));
  assert.throws(()=>validateHistoricalSnapshot(s,'1945-01-16T12:00:00Z'));
  s.fields.precipitation.units='mm/h';assert.throws(()=>validateHistoricalSnapshot(s,timestamp));
});
test('new timestamp synchronously fences old planes; historical UI has no current provider',()=>{
  const hook=fs.readFileSync(new URL('../src/utils/useHistoricalWeather.js',import.meta.url),'utf8');
  assert.match(hook,/Date\.parse\(stored\?\.timestamp\)===stamp/);assert.match(hook,/controller\.abort\(\)/);
  const panel=fs.readFileSync(new URL('../src/components/HistoricalWeatherPanel.jsx',import.meta.url),'utf8');
  assert.match(panel,/VIEW NEAREST AVAILABLE WEATHER SNAPSHOT/);assert.match(panel,/Precipitation during the preceding hour/);
  assert.match(panel,/names only/);assert.doesNotMatch(panel,/Open-Meteo|NATURAL EVENTS|GFS/);
});
