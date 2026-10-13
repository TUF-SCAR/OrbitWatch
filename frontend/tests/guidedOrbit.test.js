import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Cartesian3, Color, Entity, Matrix4, Primitive, JulianDate } from "cesium";
import { fitGuidedOrbit, guidedOrbitPhase, updateGuidedFrame } from "../src/services/guidedOrbit.js";
import { createSatelliteOrbitState, createSatelliteTrack, satelliteFrame } from "../src/services/satelliteOrbitState.js";
import { attachSatelliteOrbit, setSatelliteOrbitDisplay, styleSatelliteOrbit, updateSatelliteOrbit } from "../src/services/orbitVisuals.js";
import { StableOrbitCollection } from "../src/services/stableOrbitCollection.js";
const real=JSON.parse(readFileSync(new URL('./fixtures/satellite-load-sgp4.json',import.meta.url))).objects;

test("Guided uses real circular plane/radius and stable eccentric fallback across all44 catalog samples",()=>{
  for(const {orbit} of real) {
    const state=createSatelliteOrbitState(orbit), guide=fitGuidedOrbit(state);
    assert.ok(guide.eccentricity>=0 && guide.eccentricity<1);
    if([25867,25989,43435].includes(orbit.norad_id)) assert.ok(guide.eccentric,"eccentric astronomy spacecraft must not be circularized");
    if([25544,20580,39084,58990,26407].includes(orbit.norad_id)) assert.ok(!guide.eccentric,"LEO/polar/GEO/navigation circular guides available");
    if(guide.eccentric) continue;
    satelliteFrame(state.start,state.matrix);updateGuidedFrame(guide,state.matrix);
    const inverse=Matrix4.inverseTransformation(state.matrix,new Matrix4());
    for(const p of guide.positions) {
      const world=Matrix4.multiplyByPoint(guide.matrix,p,new Cartesian3());
      const inertial=Matrix4.multiplyByPoint(inverse,world,new Cartesian3());
      assert.ok(Math.abs(Cartesian3.magnitude(inertial)-guide.radius)<1e-6);
      assert.ok(Math.abs(Cartesian3.dot(inertial,guide.normal))<1e-6);
    }
    const refreshed=fitGuidedOrbit(state,guide);
    assert.equal(refreshed.positions,guide.positions,"same immutable circular buffer on refresh");
    assert.ok(Cartesian3.distance(refreshed.x,guide.x)<1e-12);
    assert.ok(Math.abs(guidedOrbitPhase(guide,guide.x))<1e-12);
  }
  const elliptic=e=>({positions:Array.from({length:481},(_,i)=>{
    const a=i/480*Math.PI*2;return new Cartesian3(7e6*(Math.cos(a)-e),7e6*Math.sqrt(1-e*e)*Math.sin(a),0);
  })});
  const high=fitGuidedOrbit(elliptic(.031));assert.ok(high.eccentric);
  assert.ok(fitGuidedOrbit(elliptic(.028),high).eccentric);
  const low=fitGuidedOrbit(elliptic(.024),high);assert.ok(!low.eccentric);
  assert.ok(!fitGuidedOrbit(elliptic(.028),low).eccentric);
});

test("1/6/12/24/44 both styles preserve markers/materials and circular GPU buffers during time/refresh",context=>{
  context.mock.method(Primitive.prototype,'update',function(){});
  for(const count of [1,6,12,24,44]) {
    const group=new StableOrbitCollection();
    for(const row of real.slice(0,count)) {
      const state=createSatelliteOrbitState(row.orbit),track=createSatelliteTrack(row.trajectory);
      const data={trajectory:row.trajectory,track,orbitEntity:new Entity({polyline:{positions:state.positions}})};
      styleSatelliteOrbit(data,Color.CYAN,true,count);attachSatelliteOrbit(data,group,state.positions,state);
      const material=data.orbitLine.material, scientific=data.orbitState.positions, property=track.position;
      setSatelliteOrbitDisplay(data,'guided');group.update({});
      const gpu=data.orbitLine.primitive;
      for(let i=0;i<20;i++) {
        const time=JulianDate.addSeconds(track.start,i*5,new JulianDate());
        updateSatelliteOrbit(data,time);group.update({});
        assert.equal(data.orbitLine.primitive,gpu);
        assert.equal(track.position,property);
        if(!data.orbitGuide.eccentric) {
          const phase=data.orbitLine.material.uniforms.phase*Math.PI*2;
          const guidePeak=Matrix4.multiplyByPoint(data.orbitLine.modelMatrix,new Cartesian3(Math.cos(phase),Math.sin(phase),0),new Cartesian3());
          assert.ok(Cartesian3.distance(guidePeak,track.fixedAt(time))<1e-6,"schematic peak anchored to unchanged scientific marker");
        }
      }
      track.merge(row.refresh);setSatelliteOrbitDisplay(data,'scientific');group.update({});
      assert.equal(data.orbitLine.positions,scientific);assert.equal(data.orbitLine.material,material);
      assert.equal(track.position,property);
      setSatelliteOrbitDisplay(data,'guided');group.update({});
      assert.equal(data.orbitLine.material,material);
    }
    group.destroy();assert.equal(group.length,0);
  }
});
