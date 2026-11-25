import assert from "node:assert/strict";
import test from "node:test";
import { generateOortCloud, OORT_INNER_AU, OORT_OUTER_AU, OORT_RENDER_DIVISOR, oortAuToScale, oortScaleToAu } from "../src/data/oortCloud.js";
import { AU_METERS } from "../src/data/solarSystemEphemeris.js";
import { minorOverviewVisibility, scaleToRange, solarSystemScales } from "../src/services/solarSystemLod.js";

test("seeded Oort clouds have bounded radial and directional spread and a stable lower-quality subset", () => {
  const phone = generateOortCloud("performance"), desktop = generateOortCloud("balanced");
  assert.deepEqual(phone.positions, generateOortCloud("performance").positions);
  assert.deepEqual(phone.positions, desktop.positions.slice(0, phone.positions.length));
  assert.notEqual(phone.positions[0], generateOortCloud("performance", "different").positions[0]);
  const octants = new Set(), radii = [];
  for (let i = 0; i < phone.positions.length; i += 3) {
    const [x, y, z] = phone.positions.subarray(i, i + 3);
    octants.add((x > 0 ? 4 : 0) + (y > 0 ? 2 : 0) + (z > 0 ? 1 : 0));
    const radius = Math.hypot(x, y, z) * OORT_RENDER_DIVISOR;
    assert.ok(radius > OORT_INNER_AU && radius < OORT_OUTER_AU);
    radii.push(radius);
  }
  assert.equal(octants.size, 8);
  assert.ok(Math.min(...radii) < 15000 && Math.max(...radii) > 75000);
});

test("cloud zoom has a separate interval and named minor bodies emerge before normal max", () => {
  for (const value of [0, .25, .5, .9, 1]) assert.ok(Math.abs(value - oortAuToScale(oortScaleToAu(value))) < 1e-12);
  const minimum = solarSystemScales("earth").localStart;
  assert.equal(Math.round(scaleToRange(1, minimum) / AU_METERS), 240);
  assert.ok(minorOverviewVisibility(scaleToRange(.9, minimum)) > 0);
  assert.equal(minorOverviewVisibility(240 * AU_METERS), 1);
  assert.equal(minorOverviewVisibility(AU_METERS), 0);
});
