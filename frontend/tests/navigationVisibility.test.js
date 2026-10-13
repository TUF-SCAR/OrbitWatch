import test from "node:test";
import assert from "node:assert/strict";
import { navigationVisibility, PRODUCT_MODES, TIME_CELESTIAL_IDS, celestialDestinationAllowed } from "../src/utils/navigationVisibility.js";

test("Live Earth exposes all scene controls and mode navigation", () => {
  assert.deepEqual(navigationVisibility("live", true), { modeRail: true, map: true, camera: true, system: true, explorer: true, place: true });
});
test("off-Earth Live exposes System as the return path, without Earth controls", () => {
  assert.deepEqual(navigationVisibility("live", false), { modeRail: false, map: false, camera: false, system: true, explorer: false, place: false });
});
test("Time Explorer has shared camera/system navigation and dedicated imagery without Live map selector", () => {
  assert.deepEqual(navigationVisibility("time", true), { modeRail: true, map: false, camera: true, system: true, explorer: true, place: true });
  assert.deepEqual(navigationVisibility("time", false), { modeRail: false, map: false, camera: false, system: true, explorer: false, place: false });
  assert.equal(TIME_CELESTIAL_IDS.length,9);
  for(const id of TIME_CELESTIAL_IDS) assert.ok(celestialDestinationAllowed("time",id));
  for(const id of ["moon","ceres","pluto","phobos","bennu"]) {assert.ok(!celestialDestinationAllowed("time",id));assert.ok(celestialDestinationAllowed("live",id));}
});
test("only two product modes are accepted; unknown modes have no controls", () => {
  assert.deepEqual(PRODUCT_MODES,["live","time"]);
  assert.ok(Object.values(navigationVisibility("unknown",true)).every(value=>value===false));
});
