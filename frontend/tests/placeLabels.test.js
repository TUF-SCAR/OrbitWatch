import assert from "node:assert/strict";
import test from "node:test";
import { OVERVIEW_LABELS, labelAltitudeRange, selectLabelBoxes } from "../src/services/placeLabelLayout.js";

test("offline labels have bounded global coverage and progressive detail", () => {
  assert.ok(OVERVIEW_LABELS.length > 400 && OVERVIEW_LABELS.length < 500);
  assert.equal(OVERVIEW_LABELS.filter((p) => p[3] === "country").length, 177);
  for (const [name, lon, lat, kind, rank] of OVERVIEW_LABELS) {
    assert.ok(name && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 && Number.isFinite(rank));
    const [min, max] = labelAltitudeRange(kind, rank);
    assert.ok(min > 0 && max > min);
  }
  assert.ok(OVERVIEW_LABELS.some(([name]) => name === "Visakhapatnam"));
  assert.ok(labelAltitudeRange("country", 1)[1] > labelAltitudeRange("country", 6)[1]);
  assert.ok(labelAltitudeRange("city", 1)[1] > labelAltitudeRange("city", 8)[1]);
});

test("label layout preserves priority, rejects collisions/offscreen points and caps density", () => {
  const box = (id, x, y) => ({ id, x, y, width: 50 });
  const layout = selectLabelBoxes([box("country", 100, 100), box("overlap", 110, 110), box("city", 200, 100), box("edge", 0, 50), box("bad", NaN, 50)], 400, 300);
  assert.deepEqual(layout.map((p) => p.id), ["country", "city"]);
  assert.equal(selectLabelBoxes([box("a", 100, 100), box("b", 200, 100)], 400, 300, 1).length, 1);
});
