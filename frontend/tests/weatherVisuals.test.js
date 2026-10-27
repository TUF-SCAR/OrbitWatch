import test from 'node:test';
import assert from 'node:assert/strict';
import { Cartesian3, Ellipsoid, Event } from 'cesium';
import { rainColor, rainBudget } from '../src/services/precipitationStyle.js';
import { createRainLayer } from '../src/services/rainLayer.js';
import { cloudRegion, createCloudDetail } from '../src/services/cloudDetail.js';
import { createCloudImageryService } from '../src/services/cloudImagery.js';

test('precipitation is transparent in dry/missing cells and has distinct monotone intensity alpha',()=>{
  for(const rate of [null,NaN,-1,0,.05])assert.equal(rainColor(rate)[3],0);
  let alpha=0;
  for(const rate of [.1,1,5,12,25,50,100]){const c=rainColor(rate);assert.ok(c[3]>=alpha);alpha=c[3];assert.ok(c.every(v=>v>=0&&v<=255));}
  assert.ok(rainColor(1)[2]>rainColor(1)[0]);assert.ok(rainColor(50)[0]>rainColor(50)[2]);
});

test('rain streaks use wet model anchors, bounded seeding, quality counts, reduced motion and complete disposal',()=>{
  for(const quality of ['performance','balanced','quality']){
    let clock=100,calm=false;const listeners=new Set(),collections=[],preRender=new Event(),moveEnd=new Event();
    const doc={hidden:false,addEventListener:(_n,f)=>listeners.add(f),removeEventListener:(_n,f)=>listeners.delete(f)};
    const viewer={isDestroyed:()=>false,camera:{moveEnd,positionCartographic:{height:3000000},pickEllipsoid:()=>Cartesian3.fromDegrees(78,8)},scene:{canvas:{clientWidth:1280,clientHeight:720},globe:{ellipsoid:Ellipsoid.WGS84},preRender,requestRender(){},primitives:{add(c){collections.push(c);return c;},remove(c){collections.splice(collections.indexOf(c),1);}}}};
    const makeCollection=()=>({add:opts=>({...opts})});
    const owner=createRainLayer(viewer,{doc,now:()=>clock,reduced:()=>calm,makeCollection,makeImage:()=> 'streak'});
    const field={display_variable:'precipitation',values:Array(65160).fill(8)};
    owner.update({field,visible:true,quality});preRender.raiseEvent();
    assert.equal(owner.diagnostics().capacity,rainBudget(quality).particles);assert.ok(owner.diagnostics().raining<=40);
    for(let i=0;i<20;i++){clock+=100;preRender.raiseEvent();}
    assert.equal(owner.diagnostics().raining,rainBudget(quality).particles);assert.equal(owner.diagnostics().reseeding,false);
    assert.equal(collections.length,1);assert.equal(preRender.numberOfListeners,1);assert.equal(moveEnd.numberOfListeners,1);
    calm=true;clock+=100;preRender.raiseEvent();assert.ok(owner.diagnostics().raining>0);
    viewer.camera.positionCartographic.height=22000000;clock+=100;preRender.raiseEvent();assert.equal(owner.diagnostics().raining,0);
    viewer.camera.positionCartographic.height=3000000;
    owner.update({field:{...field,values:Array(65160).fill(0)},visible:true,quality});
    for(let i=0;i<20;i++){clock+=100;preRender.raiseEvent();}assert.equal(owner.diagnostics().raining,0);
    owner.update({field,visible:false,quality});assert.equal(collections.length,0);
    owner.update({field,visible:true,quality,compatible:false});assert.equal(collections.length,0);
    owner.update({field,visible:true,quality});doc.hidden=true;listeners.forEach(f=>f());assert.equal(collections.length,0);
    doc.hidden=false;listeners.forEach(f=>f());assert.equal(collections.length,1);
    owner.destroy();owner.destroy();assert.equal(collections.length,0);assert.equal(preRender.numberOfListeners,0);assert.equal(moveEnd.numberOfListeners,0);assert.equal(listeners.size,0);
  }
});

test('cloud regional sampling stays geographic, padded, quantized, bounded and off at global/polar/dateline scales',()=>{
  for(const view of [[-180,-90,180,90],[170,-10,-170,10],[10,76,20,85]])assert.equal(cloudRegion(view,'quality'),null);
  assert.equal(cloudRegion([70,0,90,20],'performance'),null);
  const a=cloudRegion([70.1,.1,89.9,19.9],'balanced'),b=cloudRegion([70.2,.2,89.8,19.8],'balanced');
  assert.deepEqual(a,b);assert.ok(a.bounds[0]<70.1&&a.bounds[2]>89.9);assert.equal(a.width,1024);assert.equal(cloudRegion([70,0,90,20],'quality').width,2048);
});

test('regional observed requests retain exact source time and independent two-frame cache under the same request gate',async()=>{
  const urls=[],revoked=[];let sequence=0;
  const service=createCloudImageryService({now:()=>Date.parse('2026-10-26T17:00Z'),parse:()=>['2026-10-26T15:00Z'],decode:async(_blob,w,_signal,h)=>{assert.ok(w<=2048&&h<=2048);return `blob:${sequence++}`;},revoke:u=>revoked.push(u),fetcher:async url=>{urls.push(new URL(url));return {ok:true,headers:new Headers({'Content-Type':'image/jpeg'}),text:async()=>'',blob:async()=>new Blob(['synthetic test'])};}});
  const signal=new AbortController().signal,[time]=await service.slots(1,signal);
  await service.frame(time,{width:1024,frames:2},signal);
  for(let i=0;i<3;i++)await service.frame(time,{width:1024,height:768,frames:2,bounds:[60+i*5,0,90+i*5,20]},signal);
  assert.equal(service.diagnostics().cachedFrames,1);assert.equal(service.diagnostics().regionalFrames,2);assert.equal(revoked.length,1);
  const last=urls.at(-1);assert.equal(last.searchParams.get('time'),time);assert.equal(last.searchParams.get('bbox'),'70,0,100,20');assert.equal(last.searchParams.get('height'),'768');
  await service.frame(time,{width:1024,height:768,frames:2,bounds:[70,0,100,20]},signal);assert.equal(urls.length,5);
  service.destroy();assert.equal(revoked.length,4);
});

test('regional cloud owner returns to global on camera movement and cannot resurrect after leaving Earth',async()=>{
  const layers=[],listeners=new Set(),preRender=new Event(),moveStart=new Event(),moveEnd=new Event();let finish,calls=0;
  const doc={hidden:true,addEventListener:(_n,f)=>listeners.add(f),removeEventListener:(_n,f)=>listeners.delete(f)};
  const viewer={isDestroyed:()=>false,camera:{moveStart,moveEnd,computeViewRectangle:()=>({west:1,south:0,east:1.3,north:.3})},scene:{globe:{ellipsoid:Ellipsoid.WGS84},preRender,requestRender(){}},imageryLayers:{contains:l=>layers.includes(l),addImageryProvider:provider=>{const l={provider};layers.push(l);return l;},remove:l=>layers.splice(layers.indexOf(l),1)}};
  const service={frame:()=>{calls++;return new Promise(resolve=>finish=resolve);},diagnostics:()=>({requests:calls})};
  const owner=createCloudDetail(viewer,{doc,makeProvider:async frame=>frame,reduced:()=>true});
  const state={frame:{id:'global',time:'2026-10-26T15:00Z'},service,visible:true,compatible:true,ready:true,quality:'balanced',playing:false};
  owner.update(state);await new Promise(r=>setTimeout(r,700));assert.equal(calls,0,'hidden view never requests regional imagery');
  doc.hidden=false;listeners.forEach(f=>f());await new Promise(r=>setTimeout(r,700));assert.equal(calls,1);
  moveStart.raiseEvent();moveEnd.raiseEvent();await new Promise(r=>setTimeout(r,700));assert.equal(calls,1,'small camera events reuse pending regional request');
  owner.update({...state,visible:false});finish({id:'regional',time:state.frame.time});await Promise.resolve();await Promise.resolve();
  assert.equal(layers.length,0);assert.equal(owner.diagnostics().regional,false);
  owner.update({...state,playing:true});await Promise.resolve();preRender.raiseEvent();assert.equal(layers.length,1);
  moveStart.raiseEvent();await Promise.resolve();assert.equal(owner.diagnostics().regional,false);
  owner.destroy();assert.equal(layers.length,0);assert.equal(preRender.numberOfListeners,0);assert.equal(moveStart.numberOfListeners,0);assert.equal(moveEnd.numberOfListeners,0);assert.equal(listeners.size,0);
});

