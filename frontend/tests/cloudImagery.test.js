import test from 'node:test';
import assert from 'node:assert/strict';
import { Event } from 'cesium';
import { cloudBudget } from '../src/services/cloudConfig.js';
import { emphasizeInfrared, createCloudImageryService,validateCloudJpeg } from '../src/services/cloudImagery.js';
import { createCloudLayer } from '../src/services/cloudLayer.js';

const NOW=Date.parse('2026-11-14T06:00:00Z');
const signal=new AbortController().signal;
const metadata={version:'current',observation_time:new Date(NOW).toISOString(),expires_at:new Date(NOW+43200000).toISOString(),retrieved_at:new Date(NOW).toISOString()};
const result={blob:new Blob(['isolated image']),retrievedAt:new Date(NOW).toISOString()};

test('unchanged backend version reuses one decoded image without source requests',async()=>{
 let calls=0;const paths=[];const revoked=[];
 const service=createCloudImageryService({metadata:async()=>metadata,image:async path=>{calls++;paths.push(path);return {...result,retrievedAt:null};},decode:async()=> 'blob:current',revoke:u=>revoked.push(u)});
 const budget=cloudBudget('balanced');
 for(let i=0;i<12;i++){const m=await service.current(budget,signal);await service.frame(m.observation_time,budget,signal,m);}
 assert.equal(calls,1);assert.ok(paths.every(p=>p.startsWith('/api/weather/infrared/frame?')));
 assert.equal((await service.frame(metadata.observation_time,budget,signal,metadata)).retrievedAt,metadata.retrieved_at);
 assert.equal(service.diagnostics().cachedFrames,1);service.destroy();assert.deepEqual(revoked,['blob:current']);
});

test('superseded bytes remain retained by rendered layers until successful handoff',async()=>{
 let count=0;const revoked=[];
 const service=createCloudImageryService({image:async()=>result,decode:async()=>`blob:${++count}`,revoke:u=>revoked.push(u)});
 const old=await service.frame('a',{width:1024},signal);old.retain();
 await service.frame('b',{width:1024},signal);await service.frame('c',{width:1024},signal);
 assert.equal(service.diagnostics().cachedFrames,2);assert.ok(!revoked.includes(old.url));old.release();assert.ok(revoked.includes(old.url));
 service.destroy();assert.equal(revoked.length,3);
});

test('failed replacement preserves verified cache and honors backend retry deadline',async()=>{
 let clock=NOW,fail=false,calls=0;
 const service=createCloudImageryService({now:()=>clock,image:async()=>{calls++;if(fail)throw Object.assign(Error('unavailable'),{retryAfterSeconds:600});return result;},decode:async()=> 'blob:verified',revoke(){}});
 const old=await service.frame('a',{width:1024},signal);fail=true;
 await assert.rejects(service.frame('b',{width:1024},signal),/unavailable/);
 await assert.rejects(service.frame('b',{width:1024},signal),/cooling/);assert.equal(calls,2);
 assert.equal(await service.frame('a',{width:1024},signal),old);assert.equal(service.diagnostics().retryAt,NOW+600000);
 clock+=600001;await assert.rejects(service.frame('b',{width:1024},signal),/unavailable/);assert.equal(calls,3);service.destroy();
});

test('aborted conversion and destroyed service release late object URLs',async()=>{
 let finish;const revoked=[],controller=new AbortController();
 const service=createCloudImageryService({image:async()=>result,decode:()=>new Promise(r=>finish=r),revoke:u=>revoked.push(u)});
 const task=service.frame('a',{width:1024},controller.signal);while(!finish)await new Promise(r=>setTimeout(r,0));controller.abort();finish('blob:late');await assert.rejects(task,{name:'AbortError'});assert.deepEqual(revoked,['blob:late']);service.destroy();await assert.rejects(service.current({width:1024},signal),{name:'AbortError'});
});

test('regional identity and cache are bounded separately from the current global image',async()=>{
 let count=0;const service=createCloudImageryService({image:async()=>result,decode:async()=>`blob:${++count}`,revoke(){}});
 const global=await service.frame('now',{width:1024},signal);
 for(let i=0;i<8;i++)await service.frame('now',{width:1024,height:512,bounds:[i*2,0,20+i*2,10]},signal);
 assert.equal(service.diagnostics().cachedFrames,3);assert.equal(await service.frame('now',{width:1024},signal),global);service.destroy();
});

test('IR transfer preserves missing coverage and monotonic source structure without added detail',()=>{
 const pixels=new Uint8ClampedArray([0,0,0,255,85,85,85,255,160,160,160,255,235,235,235,255,255,255,255,0]);
 const output=emphasizeInfrared(pixels);assert.equal(output,pixels);assert.equal(output[3],0);assert.equal(output[7],0);assert.ok(output[11]>0&&output[11]<255);assert.ok(output[15]>output[11]);assert.equal(output[19],0);
 assert.equal(cloudBudget('performance').width,1024);assert.equal(cloudBudget('quality').width,2048);
});

function sceneFixture(){
  let clock=0;const entries=[],preRender=new Event();
  const viewer={isDestroyed:()=>false,scene:{preRender,requestRender(){}},imageryLayers:{contains:l=>entries.includes(l),addImageryProvider:provider=>{const l={provider};entries.push(l);return l;},remove(l,destroy){assert.equal(destroy,true);entries.splice(entries.indexOf(l),1);}}};
  return {viewer,entries,preRender,now:()=>clock,tick(t){clock=t;preRender.raiseEvent();}};
}
test('native imagery owner preserves old image through loading, crossfades at most two, settles and cleans up',async()=>{
  const f=sceneFixture();let finish,builds=0;
  const owner=createCloudLayer(f.viewer,{now:f.now,reduced:()=>false,makeProvider:async frame=>{builds++;if(frame.id==='slow')return new Promise(r=>finish=r);return frame;}});
  await owner.update({frame:{id:'a'},visible:true});f.tick(1000);assert.equal(f.entries.length,1);assert.equal(f.entries[0].alpha,.55);
  const loading=owner.update({frame:{id:'slow'},visible:true});assert.equal(f.entries.length,1);finish({});await loading;
  assert.equal(f.entries.length,2);f.tick(1300);assert.ok(f.entries.every(l=>l.alpha>0&&l.alpha<.55));f.tick(2000);assert.equal(f.entries.length,1);assert.equal(f.preRender.numberOfListeners,0);
  await owner.update({frame:{id:'slow'},visible:true,alpha:.2});assert.equal(builds,2);assert.equal(f.entries[0].alpha,.2);
  for(const state of [{visible:false},{visible:true,compatible:false}]){await owner.update({frame:{id:'a'},...state});assert.equal(f.entries.length,0);assert.equal(f.preRender.numberOfListeners,0);}
  await owner.update({frame:{id:'a'},visible:true});owner.destroy();owner.destroy();assert.equal(f.entries.length,0);assert.equal(f.preRender.numberOfListeners,0);
});
test('late layer completions cannot resurrect after travel/logout; reduced motion settles without animation',async()=>{
  const f=sceneFixture();let finish;
  const owner=createCloudLayer(f.viewer,{now:f.now,reduced:()=>true,makeProvider:frame=>frame.id==='slow'?new Promise(r=>finish=r):Promise.resolve(frame)});
  await owner.update({frame:{id:'a'},visible:true});f.tick(1);assert.equal(f.entries[0].alpha,.55);assert.equal(f.preRender.numberOfListeners,0);
  const pending=owner.update({frame:{id:'slow'},visible:true});owner.destroy();finish({});await pending;assert.equal(f.entries.length,0);
});
test('encoded JPEG dimensions are checked before browser pixel allocation',async()=>{
  const jpeg=new Blob([new Uint8Array([255,216,255,192,0,11,8,2,0,4,0,1,1,17,0,255,217])]);
  await validateCloudJpeg(jpeg,1024,512);
  await assert.rejects(validateCloudJpeg(jpeg,2048,1024),/dimensions/);
  await assert.rejects(validateCloudJpeg(new Blob(['XML error']),1024,512),/Invalid cloud JPEG/);
});
