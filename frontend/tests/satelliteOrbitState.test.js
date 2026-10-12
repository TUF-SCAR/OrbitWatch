import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Cartesian3, Color, Entity, JulianDate, Matrix4, Primitive } from "cesium";
import { createSatelliteOrbitState, createSatelliteTrack, readSatelliteSamples, satelliteFrame, satelliteHighlightWeight, satelliteOrbitPhase, satelliteOrbitRefreshDue, satelliteTrajectoryRefreshDue } from "../src/services/satelliteOrbitState.js";
import { attachSatelliteOrbit, removeSatelliteOrbit, satelliteOrbitStyle, styleSatelliteOrbit, updateSatelliteOrbit } from "../src/services/orbitVisuals.js";
import { StableOrbitCollection } from "../src/services/stableOrbitCollection.js";

const recorded = JSON.parse(readFileSync(new URL("./fixtures/satellite-sgp4.json", import.meta.url))).objects;
const at = (start, seconds) => JulianDate.addSeconds(start, seconds, new JulianDate());

test("recorded SGP4 LEO/polar/MEO/GEO/eccentric samples retain timestamps, radii and exact fixed/inertial round trips", () => {
  for (const { orbit } of recorded) {
    const state = createSatelliteOrbitState(orbit);
    assert.ok(state.positions.length>=480 && state.positions.length<=2000);
    for (const sample of state.samples) {
      const fixed = Matrix4.multiplyByPoint(satelliteFrame(sample.time), sample.inertial, new Cartesian3());
      assert.ok(Cartesian3.distance(fixed, sample.fixed) < 1e-6);
      assert.ok(Math.abs(Cartesian3.magnitude(sample.inertial) - Cartesian3.magnitude(sample.fixed)) < 1e-6);
    }
    const radii = state.positions.map(p => Cartesian3.magnitude(p));
    if (orbit.norad_id === 25867) assert.ok(Math.max(...radii) / Math.min(...radii) > 5, "Chandra keeps its eccentric SGP4 shape");
    if (orbit.norad_id === 25544) assert.ok(Math.max(...radii) / Math.min(...radii) < 1.01, "ISS naturally near circular");
    if (orbit.norad_id === 58990) {
      assert.ok(Cartesian3.distance(state.positions[0], state.positions[Math.floor(state.positions.length/2)]) > 8e7, "GEO is a full inertial path, not a tiny static ECEF loop");
    }
  }
  const bad = structuredClone(recorded[0].orbit);
  bad.positions[2].timestamp = bad.positions[1].timestamp;
  assert.throws(() => readSatelliteSamples(bad), /increase/);
  bad.positions[2].timestamp = "2026-10-08T00:00:00";
  assert.throws(() => readSatelliteSamples(bad), /UTC offset/);
  bad.positions[2].longitude = NaN;
  assert.throws(() => readSatelliteSamples(bad), /coordinates/);
});

test("real short trajectory remains aligned with the inertial full orbit at the exact scene timestamp", () => {
  for (const { orbit, trajectory } of recorded) {
    const state = createSatelliteOrbitState(orbit), track = createSatelliteTrack(trajectory);
    for (let second = 5; second <= 280; second += 2.5) {
      const time = at(track.start, second), inertial = track.inertialAt(time);
      const phase = satelliteOrbitPhase(state, inertial, time);
      assert.ok(Number.isFinite(phase) && phase >= 0 && phase <= 1);
      assert.ok(state.distance < Math.max(500, state.radius * .0001), `${orbit.norad_id} path error ${state.distance}m`);
      const fixed = Matrix4.multiplyByPoint(satelliteFrame(time), inertial, new Cartesian3());
      assert.ok(Cartesian3.distance(track.position.getValue(time), fixed) < 1e-6, "satellite and orbit apply exactly one shared rotation");
    }
  }
});

test("independent midpoint propagation bounds displayed chord error across the entire real orbit, including eccentric perigee", context => {
  for (const { orbit, midpoints } of recorded) {
    const state = createSatelliteOrbitState(orbit);
    let maximum = 0;
    for (const sample of readSatelliteSamples(midpoints)) {
      satelliteOrbitPhase(state,sample.inertial,sample.time);
      maximum = Math.max(maximum,state.distance);
    }
    context.diagnostic(`${orbit.norad_id}: maximum chord error ${maximum.toFixed(1)}m (${state.positions.length} samples)`);
    assert.ok(maximum < (orbit.norad_id===25867 ? 2500 : 250), `${orbit.norad_id} exceeds scientific rendering tolerance`);
  }
});

test("highlight follows actual sampled phase for a whole propagated period including seam and eccentric speed", () => {
  for (const { orbit } of recorded) {
    const state = createSatelliteOrbitState(orbit);
    for (let i = 0; i < state.samples.length - 1; i++) {
      const sample = state.samples[i], phase = satelliteOrbitPhase(state, sample.inertial, sample.time);
      assert.ok(Math.abs(phase - i / (state.samples.length-1)) < 1e-8);
    }
  }
  assert.equal(satelliteHighlightWeight(0), 1);
  assert.ok(satelliteHighlightWeight(.04) > satelliteHighlightWeight(-.04), "leading region is brighter");
  assert.ok(satelliteHighlightWeight(-.2) > satelliteHighlightWeight(.2), "soft trail is longer");
  assert.ok(Math.abs(satelliteHighlightWeight(.5 - 1e-6) - satelliteHighlightWeight(-.5 + 1e-6)) < 1e-9, "wrap is smooth, not a bright/dark seam");
});

test("overlapping refresh retains property/history without gaps; expiry freezes an explicit last valid representation", () => {
  const original = recorded[0].trajectory, track = createSatelliteTrack(original), property = track.position;
  const old = property.getValue(at(track.start, 100));
  const next = { ...original, positions:original.positions.slice(30) };
  track.merge(next);
  assert.equal(track.position, property);
  assert.ok(Cartesian3.distance(old, property.getValue(at(track.start,100))) < 1e-8);
  assert.ok(!track.isStale(at(track.stop,-1)));
  assert.ok(track.isStale(at(track.stop,1)));
  assert.ok(Cartesian3.distance(property.getValue(track.stop), property.getValue(at(track.stop,10000))) < 1e-8, "expired fixes never disappear or masquerade as current motion");
  assert.ok(satelliteTrajectoryRefreshDue({track},at(track.stop,-80)));
  assert.ok(!satelliteTrajectoryRefreshDue({track},at(track.stop,-200)));
  assert.ok(!satelliteTrajectoryRefreshDue({track,trajectoryRetryAt:Date.now()+30000},track.stop));
  assert.ok(!satelliteOrbitRefreshDue({orbitState:createSatelliteOrbitState(recorded[0].orbit),trajectory:{},orbitEpoch:undefined}));
  const changed = { ...next, tle_epoch:"2026-10-08T00:00:00Z" };
  track.merge(changed);
  assert.equal(track.samples.length,changed.positions.length,"changed orbital elements never blend with another propagator's history");
  const retained = track.samples;
  assert.throws(() => track.merge({...changed, positions:[changed.positions[0],changed.positions[0]]}),/increase/);
  assert.equal(track.samples,retained,"a malformed refresh cannot destroy the last valid representation");
});

test("1/6/12/24/44 satellites keep distinct phase/color/matrices and resident buffers through refresh/selection/focus-like cameras", context => {
  context.mock.method(Primitive.prototype,"update", function() {});
  for (const count of [1,6,12,24,44]) {
    const collection = new StableOrbitCollection(), rows = [];
    for (let i = 0; i < count; i++) {
      const sample = recorded[i % recorded.length];
      const data = { orbitEntity:new Entity({polyline:{positions:[]}}), trajectory:sample.trajectory, track:createSatelliteTrack(sample.trajectory) };
      const color = i%2 ? Color.CYAN : Color.ORANGE;
      styleSatelliteOrbit(data,color,i===0,count);
      attachSatelliteOrbit(data,collection,createSatelliteOrbitState(sample.orbit).positions,createSatelliteOrbitState(sample.orbit));
      collection.update({}); rows.push({data,color,gpu:data.orbitLine.primitive});
    }
    for (let step=0; step<50; step++) for (const {data,color,gpu} of rows) {
      const time = at(data.track.start,step*5);
      updateSatelliteOrbit(data,time); styleSatelliteOrbit(data,color,step%2===0,count);
      collection.update({});
      assert.equal(data.orbitLine.primitive,gpu); assert.equal(data.orbitLine.geometryRevision,1);
      assert.ok(Math.abs(data.orbitLine.material.uniforms.phase-data.orbitState.phase)<1e-12);
      assert.equal(data.orbitLine.material.uniforms.color.x,color.red);
      assert.equal(data.orbitEntity.polyline.show.getValue(),false);
    }
    assert.equal(collection.length,count);
    const first = rows[0].data;
    updateSatelliteOrbit(first,at(first.track.stop,600));
    assert.equal(first.orbitLine.material.uniforms.current,0,"expired track has no current highlight");
    assert.ok(Matrix4.equalsEpsilon(first.orbitLine.modelMatrix,satelliteFrame(first.track.stop),1e-12));
    for (const {data,gpu} of rows) { const material=data.orbitLine.material; removeSatelliteOrbit(data,collection); assert.ok(gpu.isDestroyed()); assert.ok(material.isDestroyed()); }
    collection.destroy();
  }
  assert.ok(satelliteOrbitStyle(true,44,2e8,1.5e8).alpha>0,"eccentric high-apogee path stays visible at its own viewing scale");
});
