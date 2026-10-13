import assert from "node:assert/strict";
import test from "node:test";
import { Event, SceneMode } from "cesium";
import { applyBaseMap } from "../src/services/baseMap.js";

function fixture() {
  const layers = ["previous map"], statuses = [], request = { current: 0 };
  const viewer = { isDestroyed: () => false, scene: { mode: SceneMode.SCENE3D, globe: {}, requestRender() {} }, imageryLayers: {
    removeAll() { layers.length = 0; }, addImageryProvider(provider) { layers.push(provider); },
    get length() { return layers.length; }, get(i) { return layers[i]; }, remove(layer) { layers.splice(layers.indexOf(layer),1); },
  } };
  return { layers, statuses, request, viewer, apply: (map, factories, timeout = 8000) => applyBaseMap(viewer, null, false, map, request, true, factories, (status) => statuses.push(status), timeout) };
}
test("metadata failure installs the fallback and names it", async () => {
  const f = fixture(), fallback = { errorEvent: new Event() };
  await f.apply("bing", { bing: () => Promise.reject(new Error("offline")), esri: () => fallback });
  assert.deepEqual(f.layers, [fallback]);
  assert.equal(f.request.activeMap, "esri");
  assert.match(f.statuses.at(-1).message, /Esri satellite fallback is active/);
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
  assert.equal(f.statuses.at(-1).state,"available");
  assert.equal(f.statuses.at(-1).message,null);
});
test("unavailable fallback leaves existing imagery visible", async () => {
  const f = fixture();
  await f.apply("bing", { bing: () => null, esri: () => { throw new Error("offline"); } });
  assert.deepEqual(f.layers, ["previous map"]);
  assert.match(f.statuses.at(-1).message, /Map imagery unavailable/);
});
test("stalled metadata has a bounded fallback and stale tile errors are detached", async () => {
  const f = fixture(), fallback = { errorEvent: new Event() };
  await f.apply("bing", { bing: () => new Promise(() => {}), esri: () => fallback }, 5);
  assert.deepEqual(f.layers, [fallback]);
  fallback.errorEvent.raiseEvent({});
  assert.match(f.statuses.at(-1).message, /Some provider tiles failed/);
  await f.apply("osm", { osm: () => ({}) });
  assert.equal(fallback.errorEvent.numberOfListeners, 0);
  fallback.errorEvent.raiseEvent({});
  assert.equal(f.statuses.at(-1).message, null);
});

test("actual first-tile failure cannot blank the globe or advertise an unavailable provider",async()=>{
  const f=fixture(),fallback={};
  await f.apply("carto-dark",{"carto-dark":()=>({requestImage:()=>Promise.reject({statusCode:403})}),esri:()=>fallback});
  assert.equal(f.request.activeMap,"esri");assert.deepEqual(f.layers,[fallback]);
  assert.equal(f.statuses.at(-1).state,"unavailable");assert.match(f.statuses.at(-1).message,/HTTP 403/);
  const missing=fixture();await missing.apply("carto-dark",{esri:()=>fallback});
  assert.equal(missing.statuses.at(-1).state,"unconfigured");
});

test("map replacement waits for first tile, cancels superseded work, and reuses settled choices",async()=>{
  const f=fixture();let finish,calls=0;
  const old=f.apply("bing",{bing:()=>({requestImage:()=>new Promise(resolve=>{finish=resolve;})})});
  await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(f.layers,["previous map"]);
  const factories={osm:()=>{calls++;return {};}};
  await f.apply("osm",factories);finish({});await old;
  await f.apply("osm",factories);assert.equal(calls,1);assert.equal(f.layers.length,1);
});

test("historical tile failure is explicitly reference imagery, never a different observation date",async()=>{
  const f=fixture();
  await f.apply("nasa-time",{"nasa-time":()=>({provider:{requestImage:()=>Promise.reject(new Error("missing"))},details:{observationDate:"2024-01-01"}}),"nasa-reference":()=>({})});
  assert.equal(f.request.activeMap,"nasa-reference");assert.equal(f.statuses.at(-1).observationDate,null);
  assert.match(f.statuses.at(-1).message,/Fixed NASA reference/);
});

test("Google only becomes active after actual initial tiles are ready; raster switches hide it",async()=>{
  const f=fixture(),google={show:false,trimLoadedTiles(){}};
  await applyBaseMap(f.viewer,google,false,"google",f.request,true,{esri:()=>({})},s=>f.statuses.push(s));
  assert.equal(f.request.activeMap,"esri");assert.equal(f.viewer.scene.globe.show,true);
  await applyBaseMap(f.viewer,google,true,"google",f.request,true,{},s=>f.statuses.push(s));
  assert.equal(f.request.activeMap,"google");assert.equal(f.viewer.scene.globe.show,false);
  await applyBaseMap(f.viewer,google,true,"osm",f.request,true,{osm:()=>({})},s=>f.statuses.push(s));
  assert.equal(google.show,false);assert.equal(f.viewer.scene.globe.show,true);assert.equal(f.layers.length,1);
});

test("pending replacement retains the active Google surface, avoiding a black Earth handoff",async()=>{
  const f=fixture(),google={show:true};f.request.activeMap="google";f.viewer.scene.globe.show=false;
  let ready;
  const replacement=applyBaseMap(f.viewer,google,true,"esri",f.request,true,{esri:()=>new Promise(resolve=>{ready=resolve;})});
  await Promise.resolve();assert.equal(google.show,true);assert.equal(f.viewer.scene.globe.show,false);
  ready({});await replacement;assert.equal(google.show,false);assert.equal(f.viewer.scene.globe.show,true);assert.equal(f.layers.length,1);
});

test("a cached NASA choice restores real imagery after off-Earth detail released its layers",async()=>{
  const f=fixture();let calls=0;const factories={"nasa-time":()=>{calls++;return {};}};
  await f.apply("nasa-time",factories);assert.equal(calls,1);
  f.viewer.imageryLayers.removeAll();await f.apply("nasa-time",factories);
  assert.equal(calls,2);assert.equal(f.layers.length,1);
});
