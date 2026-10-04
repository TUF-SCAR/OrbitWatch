import assert from "node:assert/strict";
import test from "node:test";
import { Event, SceneMode } from "cesium";
import { applyBaseMap } from "../src/services/baseMap.js";

function fixture() {
  const layers = ["previous map"], statuses = [], request = { current: 0 };
  const viewer = { isDestroyed: () => false, scene: { mode: SceneMode.SCENE3D, globe: {}, requestRender() {} }, imageryLayers: {
    removeAll() { layers.length = 0; }, addImageryProvider(provider) { layers.push(provider); },
  } };
  return { layers, statuses, request, viewer, apply: (map, factories, timeout = 8000) => applyBaseMap(viewer, null, false, map, request, true, factories, (status) => statuses.push(status), timeout) };
}
test("metadata failure installs the fallback and names it", async () => {
  const f = fixture(), fallback = { errorEvent: new Event() };
  await f.apply("bing", { bing: () => Promise.reject(new Error("offline")), esri: () => fallback });
  assert.deepEqual(f.layers, [fallback]);
  assert.equal(f.request.activeMap, "esri");
  assert.match(f.statuses.at(-1), /Esri satellite fallback is active/);
});
test("late provider metadata cannot reverse a newer map choice", async () => {
  const f = fixture(), newer = {}, older = {};
  let finish;
  const pending = f.apply("bing", { bing: () => new Promise((resolve) => { finish = resolve; }) });
  await Promise.resolve();
  await f.apply("osm", { osm: () => newer });
  finish(older);
  await pending;
  assert.deepEqual(f.layers, [newer]);
  assert.equal(f.request.activeMap, "osm");
  assert.deepEqual(f.statuses, [null]);
});
test("unavailable fallback leaves existing imagery visible", async () => {
  const f = fixture();
  await f.apply("bing", { bing: () => null, esri: () => { throw new Error("offline"); } });
  assert.deepEqual(f.layers, ["previous map"]);
  assert.match(f.statuses.at(-1), /Map imagery unavailable/);
});
test("stalled metadata has a bounded fallback and stale tile errors are detached", async () => {
  const f = fixture(), fallback = { errorEvent: new Event() };
  await f.apply("bing", { bing: () => new Promise(() => {}), esri: () => fallback }, 5);
  assert.deepEqual(f.layers, [fallback]);
  fallback.errorEvent.raiseEvent({});
  assert.match(f.statuses.at(-1), /Some map tiles could not load/);
  await f.apply("osm", { osm: () => ({}) });
  assert.equal(fallback.errorEvent.numberOfListeners, 0);
  fallback.errorEvent.raiseEvent({});
  assert.equal(f.statuses.at(-1), null);
});
