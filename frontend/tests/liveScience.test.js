import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Cartesian3,JulianDate,TimeStandard,Matrix3} from 'cesium';
import {createLiveEphemeris,julianTdb,solveLiveKepler} from '../src/services/liveEphemeris.js';
import {createSmallBodyStore,validateSmallBodyRecord} from '../src/services/solarSystemData.js';
import {createCanonicalPositions} from '../src/services/canonicalCelestialPosition.js';
import {modeEphemeris,bindLiveScience} from '../src/services/liveScience.js';
import {bodyPositionFixed,bodyPositionInertial,AU_METERS} from '../src/data/solarSystemEphemeris.js';
const records=JSON.parse(await readFile(new URL('../../tests/fixtures/jpl-compact-orbits.json',import.meta.url),'utf8'));
function tdbTime(jd){const time=new JulianDate(jd,0,TimeStandard.TAI);return JulianDate.addSeconds(time,(jd-julianTdb(time))*86400,time);}
test('compact source contracts reject malformed data and near-parabolic Kepler iteration converges',()=>{
  for(const record of records)assert.equal(validateSmallBodyRecord(record),record);
  assert.throws(()=>validateSmallBodyRecord({...records[0],frame:'B1950'}));
  assert.throws(()=>validateSmallBodyRecord({...records[0],a:NaN}));
  assert.throws(()=>validateSmallBodyRecord({...records[0],body_id:'extra-body'}));
  for(const e of [0,.4,.99,.999999])for(const m of [-3,-.001,0,.001,3]){const E=solveLiveKepler(m,e);assert.ok(Math.abs(E-e*Math.sin(E)-m)<1e-12);}
  assert.throws(()=>solveLiveKepler(1,1));
  assert.ok(Math.abs(julianTdb(tdbTime(2461356.5))-2461356.5)<1e-9);
});
test('Live canonical positions consume shared records, invalidate at paused time, and Time remains exact legacy',()=>{
  let mode='live',items=[],revision=0;const store={snapshot:()=>({items,revision})},live=createLiveEphemeris(()=>items);
  const ephemeris=modeEphemeris(()=>mode,store,live),canonical=createCanonicalPositions(ephemeris.position,{frameMatrix:(_time,result)=>Matrix3.clone(Matrix3.IDENTITY,result),getRevision:ephemeris.revision});
  const time=tdbTime(2461356.5),before=Cartesian3.clone(canonical('ceres',time));
  items=records;revision++;
  const after=Cartesian3.clone(canonical('ceres',time));assert.ok(Cartesian3.distance(before,after)>AU_METERS);
  assert.deepEqual(after,live.position('ceres',time));
  const points=live.orbit('ceres',time,96);assert.equal(points.length,97);
  assert.equal(live.describe('pluto',time).record.source,'NASA/JPL Horizons');
  mode='time';
  for(const id of ['moon','io','pluto','ceres','eros','earth'])assert.deepEqual(canonical(id,time),bodyPositionFixed(id,time));
  assert.deepEqual(ephemeris.orbit('ceres',time,4).length,5);
});
test('one frontend owner shares requests, preserves usable rows during outage, respects cooldown and cancels after last consumer',async()=>{
  let calls=0,resolve,signal,timer,clock=1000;
  const store=createSmallBodyStore({now:()=>clock,fetchRecords:s=>{signal=s;calls++;return new Promise(r=>resolve=r);},schedule:fn=>{timer=fn;return 1;},cancel(){}});
  const a=store.acquire(()=>{}),b=store.acquire(()=>{});assert.equal(calls,1);
  a();assert.equal(signal.aborted,false);resolve({items:records,refresh_due:false});await new Promise(r=>setTimeout(r,0));
  assert.equal(store.snapshot().items.length,3);b();assert.equal(signal.aborted,true);
  const c=store.acquire(()=>{});assert.equal(calls,1);clock+=900001;const pending=timer();assert.equal(calls,2);
  c();resolve({items:[],refresh_due:false});await pending;assert.equal(store.snapshot().items.length,3);
  let acquired=0,released=0,changed=0,mode='live';
  const binding=bindLiveScience({isDestroyed:()=>false,scene:{requestRender(){}}},{updatePositions(){changed++;}},()=>mode,{acquire(){acquired++;return()=>released++;}});
  binding.sync();binding.sync();assert.equal(acquired,1);mode='time';binding.sync();assert.equal(released,1);binding.destroy();assert.ok(changed>=3);
});
test('authoritative geometric ICRF/TDB comparisons use documented method tolerances and expose remaining moon limitations',async t=>{
  const live=createLiveEphemeris(()=>records),results=[];
  // NASA Table 1 nominal angular/range errors converted to a conservative
  // vector envelope including Earth's error. These are not navigation bounds.
  const toleranceKm={mercury:30000,venus:40000,mars:90000,jupiter:3500000,neptune:1700000,moon:1000,ceres:50000,eros:50000,pluto:50000};
  for(const id of ['mercury','venus','mars','jupiter','neptune','moon','io','pluto','ceres','eros']){
    const data=JSON.parse(await readFile(new URL(`../../tests/fixtures/horizons-${id}.json`,import.meta.url),'utf8'));
    assert.equal(data.signature.source,'NASA/JPL Horizons API');assert.ok(['1.2','1.3'].includes(data.signature.version));
    assert.match(data.result,/International Celestial Reference Frame/);assert.match(data.result,/Geometric state vectors have NO corrections/);
    for(const row of data.result.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n')){
      const cells=row.split(','),jd=Number(cells[0]),time=tdbTime(jd),expected=new Cartesian3(...cells.slice(2,5).map(Number).map(value=>value*1000));
      const actual=live.inertial(id,time),old=bodyPositionInertial(id,time),errorKm=Cartesian3.distance(actual,expected)/1000;
      const description=live.describe(id,time);results.push({id,jd,error_km:errorKm,legacy_error_km:Cartesian3.distance(old,expected)/1000,source:description.source});
      if(id==='io'){assert.match(description.limitation,/Schematic/);continue;}
      if(['ceres','eros','pluto'].includes(id)&&!description.record)continue; // historical dates are NOT supported by Live records
      assert.ok(errorKm<toleranceKm[id],`${id} ${jd}: ${errorKm} km exceeds method envelope`);
      if(id==='moon'||description.record)assert.ok(errorKm<Cartesian3.distance(old,expected)/1000);
    }
  }
  t.diagnostic(JSON.stringify(results));
});
