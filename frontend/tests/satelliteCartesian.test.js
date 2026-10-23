import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Cartesian3,JulianDate,Matrix4,Color,Entity} from 'cesium';
import {createSatelliteOrbitState,createSatelliteTrack,satelliteFrame,readSatelliteSamples} from '../src/services/satelliteOrbitState.js';
import {attachSatelliteOrbit,styleSatelliteOrbit,updateSatelliteOrbit} from '../src/services/orbitVisuals.js';
import {StableOrbitCollection} from '../src/services/stableOrbitCollection.js';
const rows=JSON.parse(readFileSync(new URL('./fixtures/satellite-cartesian.json',import.meta.url))).objects;
test('explicit TEME/UT1 samples match independent raw SGP4 and Skyfield ITRS, with sub-metre Hermite interpolation',context=>{
  for(const row of rows) {
    assert.ok(row.raw_sgp4_max_error_m<.001);
    const state=createSatelliteOrbitState(row.orbit),track=createSatelliteTrack(row.trajectory);
    let fixedError=0,midError=0;
    for(const s of state.samples) {
      const point=Matrix4.multiplyByPoint(satelliteFrame(s.time,new Matrix4(),s.dut1),s.inertial,new Cartesian3());
      fixedError=Math.max(fixedError,Cartesian3.distance(point,s.fixed));
    }
    for(const s of readSatelliteSamples(row.truth)) midError=Math.max(midError,Cartesian3.distance(track.inertialAt(s.time),s.inertial));
    context.diagnostic(`${row.orbit.norad_id}: ITRS ${fixedError.toFixed(4)}m; midpoint ${midError.toFixed(6)}m`);
    assert.ok(fixedError<1,'GMST/UT1 conversion agrees with Skyfield; not an observational accuracy claim');
    assert.ok(midError<1,'received velocities bound interpolation error');
    const bad=structuredClone(row.trajectory);bad.reference_frame='GCRS';assert.throws(()=>readSatelliteSamples(bad),/frame/);
  }
});
test('valid real current fixes retain highlights despite geometric projection error; true epoch/coverage failures suppress them',()=>{
  const row=rows[0],state=createSatelliteOrbitState(row.orbit),track=createSatelliteTrack(row.trajectory);
  const data={orbitEntity:new Entity({polyline:{positions:state.positions}}),trajectory:row.trajectory,track};
  const group=new StableOrbitCollection();styleSatelliteOrbit(data,Color.CYAN,true,6);attachSatelliteOrbit(data,group,state.positions,state);
  const time=JulianDate.addSeconds(track.start,45,new JulianDate());
  updateSatelliteOrbit(data,time);assert.equal(data.orbitLine.material.uniforms.current,1);
  data.orbitEpoch='other';updateSatelliteOrbit(data,time);assert.equal(data.orbitLine.material.uniforms.current,0);
  data.orbitEpoch=row.trajectory.tle_epoch;track.merge(row.refresh);updateSatelliteOrbit(data,time);assert.equal(data.orbitLine.material.uniforms.current,1);
  updateSatelliteOrbit(data,JulianDate.addSeconds(track.stop,1,new JulianDate()));assert.equal(data.orbitLine.material.uniforms.current,0);
  group.destroy();
});
