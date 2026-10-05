import assert from "node:assert/strict";
import test from "node:test";
import { layoutCelestialLabels } from "../src/services/celestialLabelLayout.js";
import { createCanonicalPositions } from "../src/services/canonicalCelestialPosition.js";
import { ALL_CELESTIAL_IDS } from "../src/data/celestialBodies.js";
import { bodyPositionFixed } from "../src/data/solarSystemEphemeris.js";
import { Cartesian3, EncodedCartesian3, JulianDate } from "cesium";
import { relativeCelestialCenter } from "../src/services/celestialSymbols.js";
import { solarSystemScales } from "../src/services/solarSystemLod.js";

test("nearby labels are deterministic, priority ordered, bounded and stable under subpixel motion", () => {
  const candidates = Array.from({ length: 12 }, (_, order) => ({ id: `body-${order}`, name: "Planet", x: 400, y: 300, priority: order, order }));
  const slots = layoutCelestialLabels(candidates, 1280, 720);
  assert.ok(slots.has("body-0"));
  assert.ok(slots.size < candidates.length, "hide crowded low-priority names");
  for (const offset of slots.values()) assert.ok(Math.hypot(...offset) <= 36, "nearby only");
  assert.deepEqual(layoutCelestialLabels(candidates, 1280, 720), slots);
  for (let i = 0; i < 100; i++) assert.deepEqual(layoutCelestialLabels(candidates.map((item) => ({ ...item, x: item.x + Math.sin(i) * 0.2 })), 1280, 720, slots), slots);
});

test("label clearance hysteresis keeps slots near collision boundaries", () => {
  const candidates = [{ id:"a", name:"Planet", x:400, y:300, priority:0, order:0 }, { id:"b", name:"Planet", x:467, y:300, priority:1, order:1 }];
  const initial = layoutCelestialLabels(candidates, 1280, 720);
  for (let i = 0; i < 100; i++) assert.deepEqual(layoutCelestialLabels(candidates.map(item => ({ ...item, x:item.x + (item.id === "b" ? Math.sin(i) * 1.5 : 0) })), 1280, 720, initial), initial);
});

test("all 47 GPU-relative centers avoid AU-scale encoded high-bit jitter", () => {
  const start = JulianDate.fromIso8601("2026-10-06T00:00:00Z");
  const encode = (body, eye) => { const a = EncodedCartesian3.encode(body), b = EncodedCartesian3.encode(eye); return Math.fround(Math.fround(Math.fround(a.high) - Math.fround(b.high)) + Math.fround(Math.fround(a.low) - Math.fround(b.low))); };
  let oldWorst = 0;
  for (const id of ALL_CELESTIAL_IDS) for (const range of [solarSystemScales(id).radius * 60, 149597870700, 240 * 149597870700]) {
    for (let frame = 0; frame < 60; frame++) {
      const time = JulianDate.addSeconds(start, frame / 60 + (frame % 2 ? 21600 : 0), new JulianDate());
      const center = bodyPositionFixed(id, time);
      const eye = Cartesian3.add(center, new Cartesian3(range * 0.3, range * 0.4, range * Math.sqrt(0.75)), new Cartesian3());
      const relative = relativeCelestialCenter(center, eye);
      const gpu = new Cartesian3(Math.fround(relative.x), Math.fround(relative.y), Math.fround(relative.z));
      assert.ok(Cartesian3.distance(relative, gpu) / range * 1000 < 0.001, `${id}: below .001 projected pixel at each render time`);
      const old = new Cartesian3(encode(center.x, eye.x), encode(center.y, eye.y), encode(center.z, eye.z));
      oldWorst = Math.max(oldWorst, Cartesian3.distance(old, relative));
    }
  }
  assert.ok(oldWorst > 10000, "regression reproduces original world-coordinate shader precision loss");
});

test("canonical centers resolve once per timestamp for every body and copy without stale coordinates", () => {
  let calls = 0;
  const center = createCanonicalPositions((...args) => { calls++; return bodyPositionFixed(...args); });
  for (const date of ["2000-01-01T12:00:00Z", "2026-10-05T00:00:00Z", "2026-10-05T06:00:00Z", "2030-01-01T00:00:00Z"]) {
    const time = JulianDate.fromIso8601(date);
    for (const id of ALL_CELESTIAL_IDS) {
      const before = calls;
      const actual = center(id, time);
      assert.deepEqual(actual, bodyPositionFixed(id, time));
      const copy = center(id, JulianDate.clone(time), new Cartesian3());
      assert.equal(calls - before, 1, id);
      assert.notEqual(copy, actual); assert.deepEqual(copy, actual);
      assert.ok([actual.x, actual.y, actual.z].every(Number.isFinite));
    }
  }
});
