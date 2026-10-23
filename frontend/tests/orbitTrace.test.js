import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {Cartesian3,Color,Entity,JulianDate,Primitive} from 'cesium';
import {attachSatelliteOrbit,styleSatelliteOrbit,updateSatelliteOrbit,TRACE_REVEAL_MS} from '../src/services/orbitVisuals.js';
import {createSatelliteOrbitState,createSatelliteTrack} from '../src/services/satelliteOrbitState.js';
import {StableOrbitCollection} from '../src/services/stableOrbitCollection.js';
const rows=JSON.parse(readFileSync(new URL('./fixtures/satellite-load-sgp4.json',import.meta.url))).objects;
function setup(row){const state=createSatelliteOrbitState(row.orbit),track=createSatelliteTrack(row.trajectory),group=new StableOrbitCollection(),data={track,trajectory:row.trajectory,orbitEntity:new Entity({polyline:{positions:state.positions}})};styleSatelliteOrbit(data,Color.CYAN,false,44,27000000,{now:0});attachSatelliteOrbit(data,group,state.positions,state);return{data,group,state};}
test('all 44 Orbit Traces preserve the actual inertial vertices and open endpoints through selection, zoom and refresh',context=>{
 context.mock.method(Primitive.prototype,'update',function(){});
 for(const row of rows){const {data,group,state}=setup(row);group.update({});const gpu=data.orbitLine.primitive,material=data.orbitLine.material;
  for(let i=0;i<25;i++){styleSatelliteOrbit(data,Color.CYAN,i%2===0,44,i*1e7,{now:i*100});updateSatelliteOrbit(data,JulianDate.addSeconds(data.track.start,i*5,new JulianDate()));group.update({});assert.equal(data.orbitLine.positions,state.positions);assert.equal(data.orbitLine.primitive,gpu);assert.equal(data.orbitLine.material,material);}
  assert.equal(data.orbitLine.positions.length,row.orbit.positions.length);
  assert.ok(Cartesian3.distance(state.positions[0],state.positions.at(-1))>0,'no forced closing vertex');
  const refreshed=createSatelliteOrbitState(row.orbit);data.track.merge(row.refresh);attachSatelliteOrbit(data,group,refreshed.positions,refreshed);group.update({});assert.equal(data.orbitLine.geometryRevision,2);assert.equal(data.orbitLine.material,material);assert.ok(gpu.isDestroyed());group.destroy();assert.ok(material.isDestroyed());
 }
});
test('selection illuminates once from real phase, survives refresh, reverses calmly and respects reduced motion',()=>{
 const {data,group}=setup(rows[0]),time=JulianDate.addSeconds(data.track.start,60,new JulianDate());updateSatelliteOrbit(data,time);
 styleSatelliteOrbit(data,Color.CYAN,true,6,27000000,{now:0});updateSatelliteOrbit(data,time);
 const u=data.orbitLine.material.uniforms;assert.equal(u.revealOrigin,u.phase);assert.equal(u.reveal,0);
 styleSatelliteOrbit(data,Color.CYAN,true,6,27000000,{now:TRACE_REVEAL_MS/2});assert.ok(u.reveal>.4&&u.reveal<.6);
 const changedAt=data.orbitVisual.changedAt,refreshed=createSatelliteOrbitState(rows[0].orbit);attachSatelliteOrbit(data,group,refreshed.positions,refreshed);assert.equal(data.orbitVisual.changedAt,changedAt);
 styleSatelliteOrbit(data,Color.CYAN,true,6,27000000,{now:TRACE_REVEAL_MS});assert.equal(u.reveal,1);assert.equal(u.selection,1);
 updateSatelliteOrbit(data,JulianDate.addSeconds(time,40,new JulianDate()));assert.notEqual(u.phase,u.revealOrigin);assert.equal(u.reveal,1,'real motion never restarts selection animation');
 styleSatelliteOrbit(data,Color.CYAN,false,6,27000000,{now:700});styleSatelliteOrbit(data,Color.CYAN,false,6,27000000,{now:810});assert.ok(u.selection>0&&u.selection<1);styleSatelliteOrbit(data,Color.CYAN,false,6,27000000,{now:950});assert.equal(u.selection,0);
 styleSatelliteOrbit(data,Color.CYAN,true,6,27000000,{now:1000,reduced:true});assert.equal(u.reveal,1);assert.equal(u.selection,1);group.destroy();
});
