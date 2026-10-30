import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SPACE_OBJECTS} from '../src/data/spaceObjects.js';
import {TIME_SATELLITE_IDS,TIME_DEFAULT_OBJECTS,TIME_OBJECTS,timeSatelliteAllowed,timeSatelliteSelection} from '../src/data/timeExplorerCatalog.js';
import {fetchHistoricalTrajectories} from '../src/services/orbitwatchApi.js';
import {createSatelliteOrbitState,createSatelliteTrack} from '../src/services/satelliteOrbitState.js';

test('the permanent Time Explorer catalog has exactly the specified 15 identities and four defaults, independently of Live',()=>{
 assert.deepEqual(TIME_SATELLITE_IDS,[25544,20580,48274,39084,25867,25994,27424,39634,40697,43435,41866,41752,26407,40544,44057]);
 assert.deepEqual(TIME_DEFAULT_OBJECTS,[25544,20580,48274,39084]);
 assert.equal(TIME_OBJECTS.length,15);assert.ok(TIME_OBJECTS.every(Boolean));assert.equal(SPACE_OBJECTS.length,143);
 assert.equal(timeSatelliteAllowed(58990),false);assert.deepEqual(timeSatelliteSelection([25544,58990,25544,20580]),[25544,20580]);
 assert.throws(()=>fetchHistoricalTrajectories([58990],'2024-06-02T16:00:00Z'),/permanent/);
 assert.throws(()=>fetchHistoricalTrajectories([25544,25544],'2024-06-02T16:00:00Z'),/permanent/);
});

test('valid historical arcs reuse the existing Cartesian track and GPU orbit state without inventing a closed period',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/satellite-sgp4.json',import.meta.url),'utf8'));
 const source=fixture.objects?.[0]?.orbit || fixture.satellites?.[0]?.orbit;
 // The recorded fixture schema is asserted below; no generated satellite path.
 assert.ok(source,'Recorded SGP4 orbit fixture is required');
 const arc={...source,historical:true,path_kind:'arc',positions:source.positions.slice(0,20)};
 const state=createSatelliteOrbitState(arc);assert.equal(state.positions.length,20);assert.ok(state.duration<state.period);
 const track=createSatelliteTrack(arc);assert.equal(track.isStale(state.start),false);
 assert.throws(()=>createSatelliteOrbitState({...arc,historical:false}),/one propagated period/);
});
