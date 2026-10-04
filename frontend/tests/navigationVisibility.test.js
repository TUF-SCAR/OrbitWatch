import test from "node:test";
import assert from "node:assert/strict";
import { navigationVisibility } from "../src/utils/navigationVisibility.js";

test("Live Earth exposes all scene controls and mode navigation", () => {
  assert.deepEqual(navigationVisibility("live", true), { modeRail: true, map: true, camera: true, system: true, explorer: true, place: true });
});
test("off-Earth Live exposes System as the return path, without Earth controls", () => {
  assert.deepEqual(navigationVisibility("live", false), { modeRail: false, map: false, camera: false, system: true, explorer: false, place: false });
});
test("Time Explorer retains Map, Objects and places without Camera or System", () => {
  assert.deepEqual(navigationVisibility("time", true), { modeRail: true, map: true, camera: false, system: false, explorer: true, place: true });
});
test("Disaster Lab retains mode navigation and places without scene menus", () => {
  assert.deepEqual(navigationVisibility("disaster", true), { modeRail: true, map: false, camera: false, system: false, explorer: false, place: true });
});
