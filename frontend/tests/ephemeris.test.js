import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ArcType, Cartesian3, JulianDate, Matrix3, Matrix4, PolylineGeometry, Transforms } from "cesium";
import { ALL_CELESTIAL_IDS, CELESTIAL_BODIES } from "../src/data/celestialBodies.js";
import { AU_METERS, bodyLocalTransform, bodyOrbitalReference, bodyPositionFixed, bodyPositionInertial, inertialToFixedMatrix, sampleBodyOrbitFixed } from "../src/data/solarSystemEphemeris.js";
import { SPACE_OBJECTS } from "../src/data/spaceObjects.js";

test("offline object catalog preserves backend IDs and search metadata", () => {
  const catalog = JSON.parse(readFileSync(new URL("../../backend/data/space_object_catalog.json", import.meta.url), "utf8"));
  assert.equal(new Set(SPACE_OBJECTS.map((object) => object.noradId)).size, SPACE_OBJECTS.length);
  for (const field of ["noradId", "name", "category", "operator", "country", "aliases"]) {
    assert.deepEqual(SPACE_OBJECTS.map((object) => object[field]), catalog.map((object) => object[field]), field);
  }
});

test("all catalog destinations have finite metre coordinates and closed orbits", () => {
  for (const date of ["2000-01-01T12:00:00Z", "2026-09-17T00:00:00Z", "2030-01-01T00:00:00Z"]) {
    const time = JulianDate.fromIso8601(date);
    for (const id of ALL_CELESTIAL_IDS) {
      const position = bodyPositionFixed(id, time);
      assert.ok(position && [position.x, position.y, position.z].every(Number.isFinite), `${id}: ${date}`);
      const reference = bodyOrbitalReference(id);
      if (CELESTIAL_BODIES[id].type === "Moon") {
        const parent = bodyPositionFixed(CELESTIAL_BODIES[id].parent, time);
        const distanceKm = Cartesian3.distance(position, parent) / 1000;
        assert.ok(distanceKm >= reference.semimajorKm * (1 - reference.eccentricity) - 1, id);
        assert.ok(distanceKm <= reference.semimajorKm * (1 + reference.eccentricity) + 1, id);
      }
      if (id === "sun") continue;
      const points = sampleBodyOrbitFixed(id, time, 96);
      assert.equal(points.length, 97, id);
      assert.ok(Cartesian3.distance(points[0], points.at(-1)) < 1, `${id}: orbit closure`);
    }
    assert.equal(Cartesian3.magnitude(bodyPositionFixed("earth", time)), 0);
    const sunDistance = Cartesian3.magnitude(bodyPositionFixed("sun", time)) / AU_METERS;
    assert.ok(sunDistance > 0.98 && sunDistance < 1.02, "Earth–Sun distance in AU");
    const moonDistance = Cartesian3.magnitude(bodyPositionFixed("moon", time)) / 1000;
    assert.ok(moonDistance > 350000 && moonDistance < 410000, "Earth–Moon distance in km");
  }
});

test("astronomical orbit geometry has a bounded vertex count", () => {
  const time = JulianDate.fromIso8601("2026-09-17T00:00:00Z");
  for (const id of ["earth", "mars", "neptune", "pluto", "eris", "bennu", "phobos"]) {
    const positions = sampleBodyOrbitFixed(id, time, 96);
    const geometry = PolylineGeometry.createGeometry(new PolylineGeometry({ positions, width: 1, arcType: ArcType.NONE }));
    assert.ok(geometry.attributes.position.values.length < 5000, id);
    assert.ok(geometry.indices.length < 2000, id);
    assert.ok(CELESTIAL_BODIES[id].radiusKm > 0);
  }
});

test("planet and moon local frames cancel Earth rotation but retain real orbital motion", (context) => {
  const start = JulianDate.fromIso8601("2026-10-04T00:00:00Z");
  // Deterministic rotation avoids network-dependent ICRF tables. A quarter
  // sidereal day makes a translation-only camera fail this regression badly.
  context.mock.method(Transforms, "computeIcrfToFixedMatrix", (time, result) => Matrix3.fromRotationZ(0.7 - JulianDate.secondsDifference(time, start) * 2 * Math.PI / 86164, result));
  const basis = Matrix3.transpose(inertialToFixedMatrix(start), new Matrix3());
  for (const focus of ["mars", "phobos", "jupiter", "europa", "saturn", "titan", "pluto", "charon"]) {
    const parent = CELESTIAL_BODIES[focus].type === "Moon" ? CELESTIAL_BODIES[focus].parent : focus;
    const family = ALL_CELESTIAL_IDS.filter((id) => id === parent || CELESTIAL_BODIES[id].parent === parent);
    for (const seconds of [0, 1 / 60, 1, 600, 21600]) {
      const time = JulianDate.addSeconds(start, seconds, new JulianDate());
      const transform = bodyLocalTransform(focus, time, basis);
      const inverse = Matrix4.inverseTransformation(transform, new Matrix4());
      assert.ok(Cartesian3.magnitude(Matrix4.multiplyByPoint(inverse, bodyPositionFixed(focus, time), new Cartesian3())) < 0.01, focus);
      for (const id of family) {
        const actual = Matrix4.multiplyByPoint(inverse, bodyPositionFixed(id, time), new Cartesian3());
        const relative = Cartesian3.subtract(bodyPositionInertial(id, time), bodyPositionInertial(focus, time), new Cartesian3());
        const expected = Matrix3.multiplyByVector(Matrix3.transpose(basis, new Matrix3()), relative, new Cartesian3());
        assert.ok(Cartesian3.distance(actual, expected) < 0.02, `${focus}/${id} at ${seconds}s`);
      }
      // Local orbit geometry must share that same frame, including its moving
      // parent; there must be no Earth-rotation contribution to its orientation.
      const moon = family.find((id) => CELESTIAL_BODIES[id].type === "Moon");
      const points = sampleBodyOrbitFixed(moon, time, 96).map((point) => Matrix4.multiplyByPoint(inverse, point, new Cartesian3()));
      const initial = sampleBodyOrbitFixed(moon, start, 96).map((point) => Matrix4.multiplyByPoint(Matrix4.inverseTransformation(bodyLocalTransform(parent, start, basis), new Matrix4()), point, new Cartesian3()));
      const parentLocal = Matrix4.multiplyByPoint(inverse, bodyPositionFixed(parent, time), new Cartesian3());
      assert.ok(Cartesian3.distance(Cartesian3.subtract(points[12], parentLocal, new Cartesian3()), initial[12]) < 0.02, `${focus}: orbit plane`);
    }
  }
  const relativeAt = (id, time) => Matrix4.multiplyByPoint(Matrix4.inverseTransformation(bodyLocalTransform(CELESTIAL_BODIES[id].parent, time, basis), new Matrix4()), bodyPositionFixed(id, time), new Cartesian3());
  const later = JulianDate.addSeconds(start, 600, new JulianDate());
  const angle = Cartesian3.angleBetween(relativeAt("deimos", start), relativeAt("deimos", later));
  assert.ok(Math.abs(angle - 2 * Math.PI * 600 / (1.2625 * 86400)) < 0.00001, "Deimos advances at its real circular-orbit rate");
  const callisto = Cartesian3.angleBetween(relativeAt("callisto", start), relativeAt("callisto", later));
  assert.ok(callisto > 0.002 && callisto < 0.003, "Callisto moves slowly; no extra 0.044 rad from Earth rotation");
});

test("local frame shares the position fallback when ICRF tables become available", (context) => {
  const time = JulianDate.fromIso8601("2026-10-04T00:00:00Z");
  let ready = false;
  context.mock.method(Transforms, "computeIcrfToFixedMatrix", (_time, result) => ready ? Matrix3.fromRotationZ(1.2, result) : undefined);
  const basis = Matrix3.transpose(inertialToFixedMatrix(time), new Matrix3());
  const local = () => Matrix4.multiplyByPoint(Matrix4.inverseTransformation(bodyLocalTransform("mars", time, basis), new Matrix4()), bodyPositionFixed("phobos", time), new Cartesian3());
  const before = local();
  ready = true;
  assert.ok(Cartesian3.distance(before, local()) < 0.001);
});
