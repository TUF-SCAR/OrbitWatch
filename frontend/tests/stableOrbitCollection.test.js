import assert from "node:assert/strict";
import test from "node:test";
import { Cartesian3, Color, Entity, JulianDate, Matrix3, Matrix4, Primitive } from "cesium";
import { ALL_CELESTIAL_IDS } from "../src/data/celestialBodies.js";
import { sampleBodyOrbitFixed } from "../src/data/solarSystemEphemeris.js";
import { createOrbitStroke, ORBIT_STROKE_SOURCE } from "../src/services/orbitStroke.js";
import { attachSatelliteOrbit, removeSatelliteOrbit, satelliteOrbitNeedsRefresh, styleSatelliteOrbit } from "../src/services/orbitVisuals.js";
import { normalizedOrbitGeometry, StableOrbitCollection } from "../src/services/stableOrbitCollection.js";

test("all 47 orbit paths retain every scientific vertex in bounded GPU coordinates", () => {
  for (const id of ALL_CELESTIAL_IDS) {
    const path = sampleBodyOrbitFixed(id, JulianDate.fromIso8601("2026-10-06T00:00:00Z"), 96);
    const normalized = normalizedOrbitGeometry(path);
    assert.equal(normalized.positions.length, path.length);
    path.forEach((point, i) => {
      assert.ok(Cartesian3.magnitude(normalized.positions[i]) <= 1 + 1e-14);
      const restored = Cartesian3.multiplyByScalar(normalized.positions[i], normalized.scale, new Cartesian3());
      assert.ok(Cartesian3.distance(point, restored) < .004, `${id}: double-precision normalization preserves vertices`);
    });
  }
});

test("time, camera, selection and visibility changes cannot rebuild or reattach resident orbit geometry", context => {
  const updates = [];
  context.mock.method(Primitive.prototype, "update", function () { updates.push(this); });
  const collection = new StableOrbitCollection();
  const path = [new Cartesian3(1e13, 0, 0),new Cartesian3(0, 1e13, 0),new Cartesian3(-1e13, 0, 0)];
  const material = createOrbitStroke(Color.CYAN);
  const line = collection.add({ positions:path, material });
  collection.update({});
  const gpu = line.primitive, geometry = gpu.geometryInstances.geometry;
  assert.equal(gpu.asynchronous,false);
  assert.equal(gpu.allowPicking,false);
  assert.equal(gpu.appearance.renderState.depthMask,false);
  assert.equal(gpu.appearance.renderState.depthTest.enabled,true);
  for (let tick=0; tick<300; tick++) {
    collection.modelMatrix = Matrix4.fromRotationTranslation(Matrix3.fromRotationZ(tick*.003),new Cartesian3(tick*1e7,0,0));
    line.width = tick%2 ? 2.5 : 3.2;
    line.material.uniforms.color.w = (tick%100)/100;
    line.show = tick%20 !== 0;
    collection.update({});
    assert.equal(line.primitive,gpu);
    assert.equal(gpu.geometryInstances.geometry,geometry);
    assert.equal(line.positions,path);
    assert.equal(line.material,material);
    assert.equal(line.geometryRevision,1);
  }
  line.show = true;
  line.positions = path.map(point=>Cartesian3.clone(point));
  collection.update({});
  assert.equal(line.geometryRevision,2,"only an actual ephemeris/path refresh replaces geometry");
  assert.ok(gpu.isDestroyed());
  assert.ok(updates.length > 250);
  collection.destroy(); collection.destroy();
  assert.ok(material.isDestroyed());
  assert.ok(line.primitive.isDestroyed());
});

test("Earth path has one renderer through selection, refresh, hide, unload and cleanup", context => {
  context.mock.method(Primitive.prototype,"update",function() {});
  const collection = new StableOrbitCollection();
  const positions = [new Cartesian3(7e6,0,0),new Cartesian3(0,7e6,0)];
  const data = { orbitEntity:new Entity({ polyline:{ positions } }),trajectory:{tle_epoch:"epoch1"} };
  const state = { period:5400, fetchedAt:Date.now(), matrix:Matrix4.clone(Matrix4.IDENTITY) };
  assert.equal(satelliteOrbitNeedsRefresh(data),true);
  styleSatelliteOrbit(data,Color.CYAN,false,6);
  attachSatelliteOrbit(data,collection,positions,state);
  assert.equal(satelliteOrbitNeedsRefresh(data),false);
  collection.update({});
  const line = data.orbitLine, gpu = line.primitive;
  assert.equal(gpu.allowPicking,true,"Earth paths keep their satellite selection target");
  assert.equal(gpu.geometryInstances.id,data.orbitEntity);
  for (const count of [1,6,34,143]) for (const selected of [false,true]) {
    styleSatelliteOrbit(data,Color.CYAN,selected,count);
    collection.update({});
    assert.equal(collection.length,1); assert.equal(line.primitive,gpu);
    assert.equal(data.orbitEntity.polyline.show.getValue(),false);
    assert.equal(line.geometryRevision,1);
  }
  data.orbitEntity.show = false;
  styleSatelliteOrbit(data,Color.CYAN,true,6);
  collection.update({}); assert.equal(gpu.show,false);
  data.trajectory = {tle_epoch:"epoch1"};
  assert.equal(satelliteOrbitNeedsRefresh(data),false,"overlapping trajectory does not invalidate the full orbit");
  data.trajectory = {tle_epoch:"epoch2"};
  assert.equal(satelliteOrbitNeedsRefresh(data),true,"new orbital elements invalidate the cached orbit");
  attachSatelliteOrbit(data,collection,positions.map(point=>Cartesian3.clone(point)),state);
  assert.equal(satelliteOrbitNeedsRefresh(data),false);
  assert.equal(collection.length,1,"refresh replaces data without a duplicate path");
  removeSatelliteOrbit(data,collection);
  assert.equal(collection.length,0); assert.ok(gpu.isDestroyed());
  collection.destroy();
});

test("pixel-integrated stroke keeps total brightness constant across subpixel camera offsets", () => {
  // Exact box/pixel overlap used by the shader, including a subpixel core.
  assert.match(ORBIT_STROKE_SOURCE,/fwidth\(t\)/);
  assert.doesNotMatch(ORBIT_STROKE_SOURCE,/fwidth\(.*abs|fwidth\(edge\)/);
  for (const width of [.7,1.1,1.8]) for (let offset=0; offset<1; offset+=.01) {
    let energy=0;
    for (let pixel=-8; pixel<=8; pixel++) energy+=Math.max(0,Math.min(pixel+.5,offset+width/2)-Math.max(pixel-.5,offset-width/2));
    assert.ok(Math.abs(energy-width)<1e-12,"camera movement cannot modulate integrated stroke opacity");
  }
});
