import test from 'node:test';
import assert from 'node:assert/strict';
import { Event } from 'cesium';
import { CLOUD_STYLE, cloudBudget } from '../src/services/cloudConfig.js';
import { cloudSlots, cloudMapUrl, emphasizeInfrared, createCloudImageryService } from '../src/services/cloudImagery.js';
import { createCloudLayer } from '../src/services/cloudLayer.js';

const NOW=Date.parse('2026-10-25T16:00:00Z');
const domain=['2021-06-06T15:00:00.000Z/2026-10-25T15:00:00.000Z/PT3H'];
const response=(type='image/jpeg')=>({ok:true,headers:new Headers({'Content-Type':type}),text:async()=>'',blob:async()=>new Blob(['real frame fixture'])});
test('cloud slots honor actual cadence, gaps, UTC and upper availability; no invented future frames',()=>{
  assert.deepEqual(cloudSlots(domain,3,NOW),['2026-10-25T09:00:00.000Z','2026-10-25T12:00:00.000Z','2026-10-25T15:00:00.000Z']);
  assert.deepEqual(cloudSlots(['2026-10-25T00:00:00Z/2026-10-25T06:00:00Z/PT3H','2026-10-25T12:00:00Z'],4,NOW).map(t=>t.slice(11,16)),['00:00','03:00','06:00','12:00']);
  assert.deepEqual(cloudSlots(['bad','2026-10-26T00:00:00Z','2026-10-25T00:00:00Z/2026-10-25T15:00:00Z/PT10M'],4,NOW),[]);
  const url=new URL(cloudMapUrl(cloudSlots(domain,1,NOW)[0],2048));
  assert.equal(url.searchParams.get('bbox'),'-180,-90,180,90');assert.equal(url.searchParams.get('srs'),'EPSG:4326');
  assert.equal(url.searchParams.get('version'),'1.1.1');assert.equal(url.searchParams.get('height'),'1024');
});
test('IR transfer preserves missing coverage and monotonic source structure without adding detail',()=>{
  const pixels=new Uint8ClampedArray([0,0,0,255,85,85,85,255,160,160,160,255,235,235,235,255,255,255,255,0]);
  const output=emphasizeInfrared(pixels);assert.equal(output,pixels);
  assert.equal(output[3],0);assert.equal(output[7],0);assert.ok(output[11]>0&&output[11]<255);assert.ok(output[15]>output[11]&&output[15]<255);assert.ok(output[12]>output[8]);assert.equal(output[19],0);
  assert.equal(cloudBudget('auto').width,2048);
});
test('all cloud quality profiles cache bounded real frames; repeated playback has zero requests',async()=>{
  for(const quality of ['performance','balanced','quality']){
    const budget=cloudBudget(quality),revoked=[];let calls=0,decoded=0;
    const service=createCloudImageryService({now:()=>NOW,parse:()=>domain,fetcher:async()=>{calls++;return response();},decode:async(_b,w)=>{assert.equal(w,budget.width);return `blob:${++decoded}`;},revoke:u=>revoked.push(u)});
    const signal=new AbortController().signal,times=await service.slots(budget.frames,signal);
    for(const t of times)await service.frame(t,budget,signal);
    for(let loop=0;loop<10;loop++)for(const t of times)await service.frame(t,budget,signal);
    assert.equal(calls,1+budget.frames);assert.equal(service.diagnostics().cachedFrames,budget.frames);
    await service.slots(budget.frames,signal);assert.equal(calls,1+budget.frames);
    await assert.rejects(service.frame('2026-10-26T00:00:00Z',budget,signal),/not advertised/);
    service.destroy();assert.equal(revoked.length,budget.frames);
    await assert.rejects(service.frame(times[0],budget,signal),{name:'AbortError'});
  }
});
test('cloud failure retains cached observation and respects Retry-After for metadata and all image requests',async()=>{
  let clock=NOW,calls=0,fail=false;
  const service=createCloudImageryService({now:()=>clock,parse:()=>domain,decode:async()=> 'blob:cached',revoke(){},fetcher:async()=>{
    calls++;return fail?{ok:false,status:429,headers:new Headers({'Retry-After':'600'})}:response();
  }});
  const signal=new AbortController().signal,b=cloudBudget('balanced'),times=await service.slots(3,signal);
  const original=await service.frame(times[0],b,signal);fail=true;
  await assert.rejects(service.frame(times[1],b,signal),/429/);
  for(let i=0;i<10;i++)await assert.rejects(service.frame(times[2],b,signal),/cooling/);
  assert.equal(calls,3);assert.equal(await service.frame(times[0],b,signal),original);
  assert.equal(service.diagnostics().retryAt,NOW+600000);
  clock+=CLOUD_STYLE.metadataTtlMs+1;
  assert.deepEqual(await service.slots(3,signal),times,'expired metadata survives outage with original slots');
  service.destroy();
});
test('quality changes evict old resolution; abort during conversion releases late URL, no invalid image admitted',async()=>{
  let finish,revoked=[],n=0,slow=false;
  const service=createCloudImageryService({now:()=>NOW,parse:()=>domain,fetcher:async()=>response(),revoke:u=>revoked.push(u),decode:()=>slow?new Promise(r=>finish=r):Promise.resolve(`blob:${++n}`)});
  const c=new AbortController(),times=await service.slots(4,c.signal);
  for(const t of times)await service.frame(t,cloudBudget('quality'),c.signal);
  await service.frame(times[3],cloudBudget('performance'),c.signal);
  assert.equal(service.diagnostics().cachedFrames,2);assert.equal(revoked.length,3);
  slow=true;const pending=service.frame(times[2],cloudBudget('performance'),c.signal);
  while(!finish)await new Promise(r=>setTimeout(r,0));c.abort();finish('blob:late');await assert.rejects(pending,{name:'AbortError'});
  assert.ok(revoked.includes('blob:late'));service.destroy();assert.equal(revoked.length,6);
});
test('cloud request ceiling cannot be bypassed by quality changes/cancellation',async()=>{
  let calls=0,n=0;
  const service=createCloudImageryService({now:()=>NOW,parse:()=>domain,fetcher:async()=>{calls++;return response();},decode:async()=>`blob:${++n}`,revoke(){}});
  const signal=new AbortController().signal,[time]=await service.slots(1,signal);
  for(let i=0;i<CLOUD_STYLE.requestsPerWindow-1;i++)await service.frame(time,{width:100+i,frames:1},signal);
  await assert.rejects(service.frame(time,{width:1000,frames:1},signal),/budget/);
  assert.equal(calls,CLOUD_STYLE.requestsPerWindow);service.destroy();
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
test('invalid server payloads cannot masquerade as observations; cached display failure is visibly reported',async()=>{
  let image=false;
  const service=createCloudImageryService({now:()=>NOW,parse:()=>domain,fetcher:async()=>response(image?'application/xml':'text/xml'),decode:()=>{throw Error('must not decode XML');}});
  const signal=new AbortController().signal,[time]=await service.slots(1,signal);image=true;
  await assert.rejects(service.frame(time,cloudBudget('balanced'),signal),/image unavailable/);
  assert.equal(service.diagnostics().cachedFrames,0);service.destroy();
  await assert.rejects(service.slots(1,signal),{name:'AbortError'});
  const f=sceneFixture();let message;
  const owner=createCloudLayer(f.viewer,{makeProvider:async frame=>{if(frame.id==='bad')throw Error('decode');return frame;},onError:error=>{message=error;}});
  await owner.update({visible:true,frame:{id:'good'}});
  await owner.update({visible:true,frame:{id:'bad'}});
  assert.equal(message,'decode');assert.equal(f.entries.length,0);assert.equal(f.preRender.numberOfListeners,0);owner.destroy();
});
