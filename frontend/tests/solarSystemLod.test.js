import assert from "node:assert/strict";
import test from "node:test";
import { AU_METERS } from "../src/data/solarSystemEphemeris.js";
import { ALL_CELESTIAL_IDS } from "../src/data/celestialBodies.js";
import { LOD_STAGES, MAX_SOLAR_RANGE, representationWeights, stableLodStage, rangeToScale, scaleToRange, distanceFade, solarSystemLod, solarSystemScales } from "../src/services/solarSystemLod.js";

test("distance policy preserves close views and reaches overview for every destination", () => {
  for (const id of ALL_CELESTIAL_IDS) {
    const scales = solarSystemScales(id);
    const close = solarSystemLod(scales, scales.radius * 5.5);
    assert.equal(close.solar, 0, id);
    assert.equal(close.overview, 0, id);
    assert.equal(solarSystemLod(scales, scales.localEnd).local, 1, id);
    const wide = solarSystemLod(scales, MAX_SOLAR_RANGE);
    assert.equal(wide.solar, 1, id);
    assert.equal(wide.overview, 1, id);
    assert.ok(scales.solarStart > scales.localEnd, id);
  }
  assert.ok(solarSystemScales("jupiter").solarStart > solarSystemScales("mars").solarStart);
  const moon = solarSystemScales("moon");
  assert.equal(moon.parent, "earth");
  assert.ok(moon.localEnd >= 384400000, "Earth/Moon system is revealed before AU context");
  const earth = solarSystemLod(solarSystemScales("earth"), 30000000);
  assert.equal(earth.stage, "close");
  assert.equal(earth.local, 0);
});

test("distance fades are bounded, continuous, monotonic and respect reduced motion", () => {
  const scales = solarSystemScales("mars");
  let previous = 0;
  for (let range = scales.radius; range < 120 * AU_METERS; range *= 1.2) {
    const value = distanceFade(range, scales.solarStart, scales.solarEnd);
    assert.ok(value >= previous && value >= 0 && value <= 1);
    previous = value;
  }
  const midpoint = Math.sqrt(scales.solarStart * scales.solarEnd);
  assert.ok(Math.abs(distanceFade(midpoint, scales.solarStart, scales.solarEnd) - 0.5) < 1e-12);
  assert.equal(distanceFade(midpoint * 0.99, scales.solarStart, scales.solarEnd, true), 0);
  assert.equal(distanceFade(midpoint * 1.01, scales.solarStart, scales.solarEnd, true), 1);
});

test("all destinations enter and exit every stage with a stable threshold band", () => {
  for (const id of ALL_CELESTIAL_IDS) {
    const scales = solarSystemScales(id);
    let stage = "close";
    const boundaries = [scales.localStart, scales.solarStart, scales.overviewStart];
    boundaries.forEach((boundary, i) => {
      stage = stableLodStage(scales, boundary * 1.16, stage);
      assert.equal(stage, LOD_STAGES[i + 1], id);
      for (let j = 0; j < 100; j++) {
        stage = stableLodStage(scales, boundary * (j % 2 ? 1.01 : 0.99), stage);
        assert.equal(stage, LOD_STAGES[i + 1], `${id}: no chatter`);
      }
    });
    boundaries.reverse().forEach((boundary, i) => { stage = stableLodStage(scales, boundary * 0.84, stage); assert.equal(stage, LOD_STAGES[2 - i], id); });
    for (let range = scales.radius; range <= MAX_SOLAR_RANGE; range *= 1.3) {
      const weights = representationWeights(range, scales.radius);
      assert.ok(weights.physical * weights.symbolic === 0, `${id}: exclusive handoff`);
      assert.ok(Number.isFinite(rangeToScale(range, scales.localStart)));
    }
    for (const value of [0, 0.1, 0.5, 0.9, 1]) assert.ok(Math.abs(rangeToScale(scaleToRange(value, scales.localStart), scales.localStart) - value) < 1e-12, id);
  }
});
