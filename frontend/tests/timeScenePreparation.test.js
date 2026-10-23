import test from 'node:test';
import assert from 'node:assert/strict';
import {Event,JulianDate} from 'cesium';
import {prepareTimeScene} from '../src/services/timeScenePreparation.js';
test('Time readiness waits for actual matching renders/maps and releases listeners on complete/cancel/timeout',async()=>{
 const event=new Event(),signal=new AbortController(),date=new Date('2024-06-01T12:00:00Z');let maps=0;
 const viewer={isDestroyed:()=>false,scene:{postRender:event,globe:{tilesLoaded:false},requestRender(){}}};
 const done=prepareTimeScene(viewer,{time:date,signal:signal.signal,earth:true,applyMap:async()=>{maps++;}});
 await Promise.resolve();assert.equal(maps,1);
 event.raiseEvent(viewer.scene,JulianDate.now());assert.equal(event.numberOfListeners,1);
 const stamp=JulianDate.fromDate(date);event.raiseEvent(viewer.scene,stamp);viewer.scene.globe.tilesLoaded=true;event.raiseEvent(viewer.scene,stamp);
 await done;assert.equal(event.numberOfListeners,0);
 const cancel=new AbortController();const cancelled=prepareTimeScene(viewer,{time:date,signal:cancel.signal,earth:false});cancel.abort();await assert.rejects(cancelled,{name:'AbortError'});assert.equal(event.numberOfListeners,0);
 await assert.rejects(prepareTimeScene(viewer,{time:date,signal:new AbortController().signal,earth:false,timeoutMs:5}),/timed out/);assert.equal(event.numberOfListeners,0);
});
