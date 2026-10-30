import test from 'node:test';
import assert from 'node:assert/strict';
import { Event, Cartesian3 } from 'cesium';
import { sampleWind, advectWind, windCartesian } from '../src/services/windAdvection.js';
import { windBudget, WIND_STYLE } from '../src/services/windConfig.js';
import { createWindLayer } from '../src/services/windLayer.js';

const field=(u=10,v=0)=>({id:'unit-only',display_variable:'wind',u:Array(65160).fill(u),v:Array(65160).fill(v)});
test('wind RK2 uses signed WGS84 east/north speed, wraps both datelines and never invents motion in calm/missing/polar cells',()=>{
  const f=field();
  assert.deepEqual(sampleWind(f,-180,0),sampleWind(f,180,0));
  assert.ok(Math.abs(advectWind(f,0,0,1000)[0]-.0898315284)<1e-8);
  assert.ok(advectWind(f,0,60,1000)[0]>.17);
  assert.ok(advectWind(f,179.99,0,1000)[0]<-179.9);
  assert.ok(advectWind(field(-10),-179.99,0,1000)[0]>179.9);
  assert.ok(advectWind(field(0,10),0,0,1000)[1]>.09);
  assert.ok(advectWind(field(0,-10),0,0,1000)[1]<-.09);
  assert.deepEqual(advectWind(field(0,0),20,20,1000),[20,20]);
  f.u[90*360+180]=null;assert.equal(sampleWind(f,0,0),null);assert.equal(advectWind(f,0,0,100),null);
  assert.equal(advectWind(f,0,89,100),null);
  const a=[],b=[];windCartesian(179.999,0,a);windCartesian(-179.999,0,b);
  assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<230,'dateline has no world-crossing segment');
});
test('wind interpolation preserves bilinear signed vectors and quality budgets bound mobile costs',()=>{
  const f=field(0,0);f.u[90*360+180]=4;f.u[90*360+181]=8;f.u[91*360+180]=12;f.u[91*360+181]=16;
  assert.equal(sampleWind(f,.5,-.5)[0],10);
  const p=windBudget('performance',1280,27000000),b=windBudget('balanced',1280,27000000),q=windBudget('quality',1280,27000000);
  assert.ok(p.particles<b.particles&&b.particles<q.particles);
  assert.ok(windBudget('quality',390,800000).particles<windBudget('quality',1280,800000).particles*.6);
  assert.ok(q.particles<windBudget('quality',1280,800000).particles*.3,'wide globe sheds density');
  assert.equal(q.speedMultiplier,WIND_STYLE.speedMultiplier);
});
function target(){const handlers=new Map();return {handlers,addEventListener(k,f){handlers.set(k,f);},removeEventListener(k){handlers.delete(k);},fire(k){handlers.get(k)?.();}};}
test('wind has one bounded owner, no timer in reduced/hidden/context-lost/off modes, and releases exact listeners/resources',()=>{
  const doc={...target(),hidden:false},media={...target(),matches:false},canvas={...target(),clientWidth:1000,clientHeight:700};
  const preRender=new Event(),primitives=[],timers=new Map();let clock=100,removed=0;
  const viewer={isDestroyed:()=>false,camera:{positionCartographic:{height:20000000},pickEllipsoid:()=>Cartesian3.fromDegrees(70,10)},scene:{canvas,preRender,requestRender(){},primitives:{add(p){primitives.push(p);return p;},remove(p){primitives.splice(primitives.indexOf(p),1);p.destroy();removed++;}}}};
  const owner=createWindLayer(viewer,{doc,media,now:()=>clock,schedule:(f,ms)=>{timers.set(f,ms);return f;},cancel:f=>timers.delete(f),random:()=>.4,makePrimitive:n=>({data:new Float32Array(n*8),destroy(){this.destroyed=true;}})});
  const options={field:field(),visible:true,compatible:true,opacity:.55,quality:'balanced'};
  owner.update(options);assert.equal(timers.size,1);assert.equal(primitives.length,1);
  const first=primitives[0];for(let i=0;i<40;i++){clock+=45;preRender.raiseEvent();}
  assert.ok(first.count>0);assert.equal(primitives[0],first);
  const moving=first.data.slice();clock+=45;preRender.raiseEvent();assert.notDeepEqual(first.data,moving);
  owner.update({...options,opacity:.3});assert.equal(primitives[0],first,'opacity does not rebuild');
  owner.setAltitudeAlpha(.5);assert.ok(Math.abs(first.alpha-(.3/.55)*.5)<1e-9);
  owner.setAltitudeAlpha(0);assert.equal(first.show,false);const hiddenBuffer=first.data.slice();
  clock+=90;preRender.raiseEvent();assert.deepEqual(first.data,hiddenBuffer);assert.equal(primitives[0],first);assert.equal(timers.size,1);
  owner.setAltitudeAlpha(1);assert.equal(first.show,true);assert.ok(Math.abs(first.alpha-.3/.55)<1e-9);assert.equal(primitives[0],first);
  canvas.clientWidth=390;clock+=45;preRender.raiseEvent();
  assert.deepEqual([...timers.values()],[1000/24],'resize applies mobile cadence');
  assert.equal(primitives[0],first,'resize preserves particle buffer');
  canvas.clientWidth=1000;clock+=45;preRender.raiseEvent();
  assert.deepEqual([...timers.values()],[1000/30],'desktop cadence resumes with exactly one timer');
  media.matches=true;media.fire('change');assert.equal(timers.size,0);assert.equal(preRender.numberOfListeners,0);assert.ok(primitives[0].count>0);
  doc.hidden=true;doc.fire('visibilitychange');assert.equal(primitives.length,0);
  doc.hidden=false;doc.fire('visibilitychange');assert.equal(primitives.length,1);assert.equal(timers.size,0);
  media.matches=false;media.fire('change');assert.equal(timers.size,1);
  canvas.fire('webglcontextlost');assert.equal(primitives.length,0);assert.equal(timers.size,0);
  canvas.fire('webglcontextrestored');assert.equal(primitives.length,1);
  owner.update({...options,compatible:false});assert.equal(primitives.length,0);assert.equal(timers.size,0);
  owner.update(options);owner.update({...options,field:{id:'temperature'}});assert.equal(primitives.length,0);
  owner.update(options);owner.update({...options,visible:false});assert.equal(primitives.length,0);
  owner.update(options);owner.update({...options,opacity:0});assert.equal(primitives.length,0);
  owner.update(options);owner.destroy();owner.destroy();assert.equal(primitives.length,0);assert.equal(timers.size,0);assert.equal(preRender.numberOfListeners,0);
  assert.equal(doc.handlers.size+media.handlers.size+canvas.handlers.size,0);assert.ok(removed>=8);
});

for (const quality of ['performance','balanced','quality']) test(`wind ${quality} zoom reseeds in bounded batches with warm trails and unchanged advection`,()=>{
  const doc={...target(),hidden:false},media={...target(),matches:false},canvas={...target(),clientWidth:1280,clientHeight:720};
  const preRender=new Event(),primitives=[],timers=new Set();let clock=100,picks=0;
  const camera={positionCartographic:{height:22000000},pickEllipsoid(){picks++;return Cartesian3.fromDegrees(70,10);}};
  const viewer={isDestroyed:()=>false,camera,scene:{canvas,preRender,requestRender(){},primitives:{add(p){primitives.push(p);return p;},remove(p){primitives.splice(primitives.indexOf(p),1);}}}};
  const f=field(10,4);
  const owner=createWindLayer(viewer,{doc,media,now:()=>clock,random:()=>.4,schedule:fn=>{timers.add(fn);return fn;},cancel:fn=>timers.delete(fn),makePrimitive:n=>({data:new Float32Array(n*8)})});
  owner.update({field:f,visible:true,compatible:true,opacity:.55,quality});
  const first=primitives[0],buffer=first.data;
  assert.equal(picks,WIND_STYLE.reseedPerUpdate,'cold start work is bounded');
  assert.ok(first.count>=WIND_STYLE.reseedPerUpdate*WIND_STYLE.trailSegments,'trails exist immediately, without waiting for history');
  assert.ok(first.data[6]>.99,'refreshed particles begin mature, not in a long fade');
  assert.notDeepEqual([...first.data.slice(8,11)],[...first.data.slice(11,14)],'warm history has real spatial extent');
  function advance(n=1){for(let i=0;i<n;i++){clock+=50;preRender.raiseEvent();}}
  advance(30);
  assert.equal(owner.diagnostics().reseedPending,0);
  camera.positionCartographic.height=21000000;advance(20);
  assert.equal(owner.diagnostics().zoomRefreshes,0,'tiny zoom does not refresh');
  for(const height of [3000000,300000,22000000]){
    camera.positionCartographic.height=height;
    const before=owner.diagnostics().zoomRefreshes;
    advance();assert.equal(owner.diagnostics().zoomRefreshes,before,'waits for zoom to settle');
    let safety=0;
    while(owner.diagnostics().zoomRefreshes===before&&safety++<30)advance();
    assert.equal(owner.diagnostics().zoomRefreshes,before+1);
    assert.ok(owner.diagnostics().reseedPending>0,'refresh spreads work across updates');
    const expected=advectWind(f,70,10,.05*windBudget(quality,1280,height).speedMultiplier);
    const xyz=[];windCartesian(...expected,xyz);
    advance();
    for(let k=0;k<3;k++)assert.ok(Math.abs(first.data[k]-xyz[k])<1,'first post-refresh step uses the original speed, not a boost');
    advance(40);
    let settled=expected;
    for(let i=0;i<40;i++)settled=advectWind(f,...settled,.05*windBudget(quality,1280,height).speedMultiplier);
    windCartesian(...settled,xyz);
    for(let k=0;k<3;k++)assert.ok(Math.abs(first.data[k]-xyz[k])<1,'settled speed remains the original speed after warm-up');
    assert.equal(owner.diagnostics().reseedPending,0);
    assert.equal(owner.diagnostics().zoomRefreshes,before+1,'settled camera does not continuously reseed');
    assert.equal(primitives[0],first);assert.equal(first.data,buffer);assert.equal(timers.size,1);
  }
  owner.destroy();assert.equal(timers.size,0);assert.equal(primitives.length,0);
});

test('wind adaptive recovery is gradual, hysteretic, bounded and resets on real restarts',()=>{
  const doc={...target(),hidden:false},media={...target(),matches:false},canvas={...target(),clientWidth:1000,clientHeight:700};
  const preRender=new Event(),primitives=[],timers=new Set();let clock=100,picks=0;
  const viewer={isDestroyed:()=>false,camera:{positionCartographic:{height:20000000},pickEllipsoid(){picks++;return Cartesian3.fromDegrees(70,10);}},scene:{canvas,preRender,requestRender(){},primitives:{add(p){primitives.push(p);return p;},remove(p){primitives.splice(primitives.indexOf(p),1);}}}};
  const owner=createWindLayer(viewer,{doc,media,now:()=>clock,random:()=>.4,schedule:fn=>{timers.add(fn);return fn;},cancel:fn=>timers.delete(fn),makePrimitive:n=>({data:new Float32Array(n*8)})});
  const options={field:field(),visible:true,compatible:true,opacity:.55,quality:'balanced'};
  owner.update(options);const first=primitives[0];
  const run=(n,ms)=>{for(let i=0;i<n;i++){clock+=ms;preRender.raiseEvent();}};
  run(35,100);const low=owner.diagnostics().qualityScale;assert.ok(low<1);
  run(100,40);assert.equal(owner.diagnostics().qualityScale,low,'brief relief does not recover');
  run(225,40);const rising=owner.diagnostics().qualityScale;assert.ok(rising>low&&rising<1,'sustained relief recovers only a small step');
  const before=picks;run(1,40);assert.ok(picks-before<=WIND_STYLE.reseedPerUpdate);
  run(35,100);assert.ok(owner.diagnostics().qualityScale<rising,'renewed overload wins during recovery');
  run(2000,40);assert.equal(owner.diagnostics().qualityScale,1,'healthy performance eventually restores full budget');
  assert.equal(primitives[0],first);assert.equal(timers.size,1);assert.equal(preRender.numberOfListeners,1);
  run(35,100);assert.ok(owner.diagnostics().qualityScale<1);
  owner.update({...options,quality:'performance'});assert.equal(owner.diagnostics().qualityScale,1);assert.equal(owner.diagnostics().particles,1800);
  run(35,100);assert.ok(owner.diagnostics().qualityScale<1);
  owner.update({...options,visible:false});owner.update(options);assert.equal(owner.diagnostics().qualityScale,1);
  owner.destroy();assert.equal(timers.size,0);assert.equal(primitives.length,0);assert.equal(preRender.numberOfListeners,0);
});
