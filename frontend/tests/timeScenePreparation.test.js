import test from 'node:test';
import assert from 'node:assert/strict';
import {Cartesian3,Clock,ClockStep,Event,JulianDate,Transforms} from 'cesium';
import {prepareTimeScene,updateSceneTime} from '../src/services/timeScenePreparation.js';
import {formatDateTimeLocal} from '../src/utils/spaceFormatters.js';
import {bodyPositionFixed} from '../src/data/solarSystemEphemeris.js';
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

test('loaded reference imagery does not make mathematical time updates wait for unrelated tiles',async()=>{
 const event=new Event(),viewer={isDestroyed:()=>false,scene:{postRender:event,globe:{tilesLoaded:false},requestRender(){}}};
 for(const date of ['1990-01-01','2005-06-01','2024-06-01','2026-10-30','2035-01-01']) {
  const time=new Date(`${date}T12:00:00Z`),stamp=JulianDate.fromDate(time);
  const done=prepareTimeScene(viewer,{time,signal:new AbortController().signal,earth:true,waitForTiles:false,applyMap:async()=>{}});
  await Promise.resolve();event.raiseEvent(viewer.scene,stamp);event.raiseEvent(viewer.scene,stamp);await done;
  assert.equal(event.numberOfListeners,0);
 }
});

test('rapid time changes cancel older readiness results and release their listeners',async()=>{
 const event=new Event(),viewer={isDestroyed:()=>false,scene:{postRender:event,globe:{tilesLoaded:true},requestRender(){}}};
 const older=new AbortController(),time=new Date('2035-01-01T00:00:00Z');
 const old=prepareTimeScene(viewer,{time:new Date('1990-01-01'),signal:older.signal,earth:false});
 const rejected=assert.rejects(old,{name:'AbortError'});older.abort();
 const done=prepareTimeScene(viewer,{time,signal:new AbortController().signal,earth:false});
 const stamp=JulianDate.fromDate(time);event.raiseEvent(viewer.scene,stamp);event.raiseEvent(viewer.scene,stamp);
 await Promise.all([rejected,done]);assert.equal(event.numberOfListeners,0);
});

test('local inputs preserve their absolute UTC instant through scientific JulianDate conversion',()=>{
 for(const date of ['1990-01-01T00:00','2005-06-01T18:30','2024-06-01T12:00','2026-10-30T23:59','2035-01-01T00:00']) {
  const local=new Date(date);assert.equal(formatDateTimeLocal(local),date);
  assert.equal(JulianDate.toDate(JulianDate.fromDate(local)).getTime(),local.getTime());
 }
});

test('the shared scene clock drives astronomy across dates and restores the Live clock without imagery access',context=>{
 // Offline test rotation: no asynchronous ICRF tables or network dependency.
 context.mock.method(Transforms,'computeIcrfToFixedMatrix',Transforms.computeTemeToPseudoFixedMatrix);
 const clock=new Clock(),viewer={clock,scene:{requestRender(){}}};
 for(const day of ['1990-01-01','2005-06-01','2024-06-01','2026-10-30','2035-01-01']) {
  const time=new Date(`${day}T00:00:00Z`);updateSceneTime(viewer,time,'time',30);
  assert.equal(clock.shouldAnimate,false);assert.equal(JulianDate.toDate(clock.currentTime).getTime(),time.getTime());
  const sun=bodyPositionFixed('sun',clock.currentTime),mars=bodyPositionFixed('mars',clock.currentTime);
  updateSceneTime(viewer,new Date(time.getTime()+43200000),'time',30);
  assert.ok(Cartesian3.angleBetween(sun,bodyPositionFixed('sun',clock.currentTime))>2.2,'day/night direction changes with time, including solar declination');
  assert.ok(Cartesian3.distance(mars,bodyPositionFixed('mars',clock.currentTime))>1000);
 }
 updateSceneTime(viewer,new Date('1990-01-01'),'live',30);
 assert.equal(clock.shouldAnimate,true);assert.equal(clock.clockStep,ClockStep.SYSTEM_CLOCK);
 assert.ok(Math.abs(JulianDate.toDate(clock.currentTime).getTime()-Date.now())<1000);
 assert.equal(viewer.scene.maximumRenderTimeChange,1/30);
});
