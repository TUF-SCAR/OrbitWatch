import assert from "node:assert/strict";
import test from "node:test";
import { Color, EntityCollection, SampledPositionProperty } from "cesium";
import { createSelectedSatelliteDetail } from "../src/services/selectedSatelliteDetail.js";

const hubble = { noradId: 20580, name: "Hubble Space Telescope", category: "Observatories" };
function fixture() {
  const entities = new EntityCollection();
  const changes = [];
  entities.collectionChanged.addEventListener((_, added, removed) => changes.push({ added: added.length, removed: removed.length }));
  const layer = createSelectedSatelliteDetail({ entities, isDestroyed: () => false }, { Observatories: Color.CYAN });
  return { layer, entities, changes };
}

test("trajectory refresh retains the selected model and updates its position ownership", () => {
  const f = fixture(), base = { position: new SampledPositionProperty() };
  const detail = f.layer.update(hubble, base, true), model = detail.model;
  for (let i = 0; i < 50; i += 1) {
    base.position = new SampledPositionProperty();
    assert.equal(f.layer.update(hubble, base, true), detail);
    assert.equal(detail.model, model);
    assert.equal(detail.position, base.position);
    assert.equal(detail.orientation.position, base.position);
  }
  assert.equal(f.entities.values.length, 1);
  assert.equal(f.changes.reduce((sum, change) => sum + change.added, 0), 1);
  assert.equal(f.changes.reduce((sum, change) => sum + change.removed, 0), 0);
  f.layer.clear();
  assert.equal(f.entities.values.length, 0);
});

test("away, unload and unsupported selections release the optional model; return restores it", () => {
  const f = fixture(), base = { position: new SampledPositionProperty() };
  for (const [object, target, active] of [[hubble, base, false], [hubble, null, true], [{ noradId: 25544 }, base, true]]) {
    const previous = f.layer.update(hubble, base, true);
    assert.ok(previous);
    assert.equal(f.layer.update(object, target, active), null);
    assert.equal(f.entities.values.length, 0);
    assert.notEqual(f.layer.update(hubble, base, true), previous);
  }
  f.layer.clear();
  f.layer.clear();
  assert.equal(f.entities.values.length, 0);
});
