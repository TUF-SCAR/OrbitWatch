import assert from 'node:assert/strict';
import test from 'node:test';
import { Event } from 'cesium';
import {sampleTemperature,temperatureColor,temperaturePixels,validateTemperatureField,weatherFreshness} from '../src/services/temperatureGrid.js';
import {createTemperatureLayer,weatherTextureWidth} from '../src/services/temperatureLayer.js';
import {createWeatherCompute} from '../src/services/weatherCompute.js';
test('display texture budgets are bounded, use four samples per source degree by default and preserve low-memory fallback',()=>{
  assert.equal(weatherTextureWidth('balanced'),1440);assert.equal(weatherTextureWidth('quality'),2160);
  assert.equal(weatherTextureWidth('performance'),720);assert.equal(weatherTextureWidth('auto',4),720);assert.equal(weatherTextureWidth('auto',8),1440);
});

test('late asynchronous rasters cannot restore hidden or older fields; pending opacity changes reuse one job',async()=>{
  const entries=[],preRender=new Event(),jobs=[];
  const viewer={isDestroyed:()=>false,scene:{preRender,requestRender(){}},imageryLayers:{contains:layer=>entries.includes(layer),addImageryProvider:provider=>{const layer={provider};entries.push(layer);return layer;},remove:layer=>entries.splice(entries.indexOf(layer),1)}};
  const owner=createTemperatureLayer(viewer,{makeProvider:field=>new Promise(resolve=>jobs.push({id:field.id,resolve})),reduced:()=>true});
  owner.update({field:{id:'older'},visible:true});owner.update({field:{id:'older'},visible:true,opacity:.2});assert.equal(jobs.length,1);
  owner.update({field:{id:'newer'},visible:true});jobs[0].resolve({id:'older'});await Promise.resolve();assert.equal(entries.length,0);
  jobs[1].resolve({id:'newer'});await Promise.resolve();preRender.raiseEvent();assert.equal(entries[0].provider.id,'newer');
  owner.update({field:{id:'pending'},visible:true});owner.update({visible:false,immediate:true});jobs[2].resolve({id:'pending'});await Promise.resolve();assert.equal(entries.length,0);
  owner.destroy();assert.equal(preRender.numberOfListeners,0);
});

test('one weather worker coalesces queued changes and aborts outstanding work on destroy',async()=>{
  const sent=[];let terminated=false;
  const worker={postMessage:job=>sent.push(job),terminate:()=>{terminated=true;}};
  const compute=createWeatherCompute({makeWorker:()=>worker}),field={id:'fixture',values_c:Array(65160).fill(20)};
  const first=compute.raster(field,4,2),obsolete=compute.raster(field,8,4).catch(error=>error.name),latest=compute.raster(field,16,8);
  assert.equal(sent.length,1);assert.equal(await obsolete,'AbortError');
  worker.onmessage({data:{id:sent[0].id,result:new Uint8ClampedArray(32)}});await first;
  assert.equal(sent.length,2);assert.equal(sent[1].width,16);
  const cancelled=latest.catch(error=>error.name);compute.destroy();assert.equal(await cancelled,'AbortError');assert.equal(terminated,true);
});
function field() {
  return {id:'test-generated',units:'°C',valid_at:'2026-10-23T12:00:00Z',retrieved_at:'2026-10-23T12:05:00Z',state:'available',
    grid:{width:360,height:181,west:-180,north:90,step:1},values_c:Array.from({length:65160},(_,i)=>(90-Math.floor(i/360))*.1+Math.sin((i%360-180)*Math.PI/180))};
}
test('temperature texture follows true node geography, poles, antimeridian and missing values',()=>{
  const f=field();validateTemperatureField(f);
  assert.equal(sampleTemperature(f,0,90),9);assert.equal(sampleTemperature(f,0,-90),-9);
  assert.ok(Math.abs(sampleTemperature(f,90,0)-1)<1e-10);assert.ok(Math.abs(sampleTemperature(f,-90,0)+1)<1e-10);
  assert.equal(sampleTemperature(f,-180,0),sampleTemperature(f,180,0));
  assert.ok(Math.abs(sampleTemperature(f,-179.999,0)-sampleTemperature(f,179.999,0))<.0001);
  assert.equal(sampleTemperature(f,0,91),null);f.values_c[90*360+180]=null;
  assert.equal(sampleTemperature(f,0,0),null);assert.equal(temperatureColor(null)[3],0);
  assert.deepEqual(temperatureColor(-100),temperatureColor(-60));assert.deepEqual(temperatureColor(100),temperatureColor(60));
  assert.equal(temperaturePixels(f,36,18).length,36*18*4);
  assert.throws(()=>validateTemperatureField({...f,units:'K'}));
});
test('original model valid/retrieval times drive stale and hard expiry, never present stale as current observations',()=>{
  const f=field();assert.equal(weatherFreshness(f,Date.parse('2026-10-23T15:00:00Z')),'available');
  assert.equal(weatherFreshness(f,Date.parse('2026-10-23T19:00:00Z')),'stale');
  assert.equal(weatherFreshness(f,Date.parse('2026-10-24T13:00:00Z')),'unavailable');
  assert.equal(weatherFreshness({...f,state:'stale'},Date.parse('2026-10-23T15:00:00Z')),'stale');
  assert.equal(weatherFreshness(f,Date.parse('2026-10-23T12:19:00Z'),'location'),'available');
  assert.equal(weatherFreshness(f,Date.parse('2026-10-23T12:21:00Z'),'location'),'stale');
  assert.equal(weatherFreshness(f,Date.parse('2026-10-23T15:01:00Z'),'location'),'unavailable');
});
test('one weather imagery owner survives opacity/map changes and releases all frames/layers on toggle, Google, travel and logout',()=>{
  const entries=[],preRender=new Event();let clock=0,builds=0,disposed=0;
  const viewer={isDestroyed:()=>false,scene:{preRender,requestRender(){}},imageryLayers:{
    contains:layer=>entries.includes(layer),addImageryProvider:provider=>{const layer={provider,alpha:1};entries.push(layer);return layer;},
    remove(layer,destroy){assert.equal(destroy,true);entries.splice(entries.indexOf(layer),1);disposed++;}}};
  const owner=createTemperatureLayer(viewer,{makeProvider:()=>({build:++builds}),now:()=>clock,reduced:()=>false});
  const f=field();owner.update({field:f,visible:true,opacity:.55});assert.equal(entries.length,1);assert.equal(entries[0].alpha,0);
  clock=400;preRender.raiseEvent();assert.equal(entries[0].alpha,.55);assert.equal(preRender.numberOfListeners,0);
  for(let i=0;i<40;i++)owner.update({field:f,visible:true,opacity:.3});assert.equal(builds,1);assert.equal(preRender.numberOfListeners,1);
  clock=800;preRender.raiseEvent();assert.equal(entries[0].alpha,.3);
  owner.update({visible:false});clock=1200;preRender.raiseEvent();assert.equal(entries.length,0);assert.equal(preRender.numberOfListeners,0);
  owner.update({field:f,visible:true});owner.update({field:f,visible:true,compatible:false});assert.equal(entries.length,0);
  owner.update({field:f,visible:true});owner.update({visible:false,immediate:true});assert.equal(entries.length,0);
  owner.update({field:f,visible:true});owner.destroy();owner.destroy();assert.equal(entries.length,0);assert.equal(preRender.numberOfListeners,0);assert.equal(disposed,4);
  const calmOwner=createTemperatureLayer(viewer,{makeProvider:()=>({}),now:()=>clock,reduced:()=>true});
  calmOwner.update({field:f,visible:true});preRender.raiseEvent();
  assert.equal(entries[0].alpha,.55);assert.equal(preRender.numberOfListeners,0);
  calmOwner.update({visible:false});preRender.raiseEvent();calmOwner.destroy();
  assert.equal(entries.length,0);assert.equal(preRender.numberOfListeners,0);
});
