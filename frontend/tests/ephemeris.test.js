import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ArcType, Cartesian3, JulianDate, PolylineGeometry } from "cesium";
import { ALL_CELESTIAL_IDS, CELESTIAL_BODIES } from "../src/data/celestialBodies.js";
import { AU_METERS, bodyOrbitalReference, bodyPositionFixed, sampleBodyOrbitFixed } from "../src/data/solarSystemEphemeris.js";
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
      if (id === "earth" || id === "sun") continue;
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
  for (const id of ["mars", "neptune", "pluto", "eris", "bennu", "phobos"]) {
    const positions = sampleBodyOrbitFixed(id, time, 96);
    const geometry = PolylineGeometry.createGeometry(new PolylineGeometry({ positions, width: 1, arcType: ArcType.NONE }));
    assert.ok(geometry.attributes.position.values.length < 5000, id);
    assert.ok(geometry.indices.length < 2000, id);
    assert.ok(CELESTIAL_BODIES[id].radiusKm > 0);
  }
});
