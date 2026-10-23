import test from 'node:test';
import assert from 'node:assert/strict';
import {createHudAssembly,footprint,revealPlan} from '../src/services/hudAssembly.js';
import {previewSession,previewStep} from '../src/utils/previewMotion.js';
test('footprints ignore empty wrappers and reveal actual instruments smallest first',()=>{
 const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
 const actual=footprint([rect(20,20,0,0),rect(90,20,200,40),rect(1000,20,300,40)].map(r=>({getBoundingClientRect:()=>r})));
 assert.deepEqual(actual,{left:90,top:20,width:1210,height:40});
 const entries=[{id:'header',rect:actual},{id:'dock',rect:rect(0,0,450,60)},{id:'search',rect:rect(0,0,48,48)}];
 const plan=revealPlan(entries,{loader:240,interval:175});assert.deepEqual(plan.map(x=>x.id),['search','dock','header']);assert.deepEqual(plan.map(x=>x.delay),[240,415,590]);
});
test('one assembly clock gates input, preserves mounted nodes, cancels stale completions and skips reduced motion',async t=>{
 const previousStyle=globalThis.getComputedStyle,previousObserver=globalThis.ResizeObserver;
 globalThis.getComputedStyle=()=>({getPropertyValue:()=> '3px'});
 const observers=[];globalThis.ResizeObserver=class {constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.closed=true;}};
 t.after(()=>{globalThis.getComputedStyle=previousStyle;globalThis.ResizeObserver=previousObserver;});
 const root={dataset:{}},queue=new Map(),pending=[],timing={loader:10,interval:10,morph:10,ease:[.22,1,.36,1]};let next=0,time=0;
 const owner=createHudAssembly({root:()=>root,timings:()=>timing,reduced:()=>false,raf:fn=>{queue.set(++next,fn);return next;},caf:id=>queue.delete(id),now:()=>time,animate:()=>{let resolve;const p=new Promise(r=>resolve=r);p.stop=()=>{p.stopped=true;};pending.push({p,resolve});return p;}});
 const nodes=width=>{const child={getBoundingClientRect:()=>({left:10,top:20,width,height:40,right:10+width,bottom:60})};return{stage:{dataset:{},clientWidth:1366,clientHeight:768},shell:{style:{}},content:{style:{},children:[child],querySelectorAll:()=>[],getBoundingClientRect:()=>({left:0,top:0})}};};
 const large=nodes(400),small=nodes(40),remove=owner.register('large',large);owner.register('small',small);
 // React activates the outer stage before the coordinator starts its clock.
 large.stage.inert=false;small.stage.inert=false;owner.start();
 function step(ms){time=ms;const f=[...queue.values()];queue.clear();f.forEach(fn=>fn(ms));}
 step(0);assert.equal(large.stage.dataset.hudStartedAt,small.stage.dataset.hudStartedAt);assert.equal(small.stage.inert,true);
 step(10);assert.equal(small.stage.dataset.hudPhase,'morph');assert.equal(large.stage.dataset.hudPhase,'loading');assert.equal(small.content.children.length,1);
 pending[0].resolve();await Promise.resolve();assert.equal(small.stage.inert,false);step(20);owner.cancel();pending[1].resolve();await Promise.resolve();assert.notEqual(large.stage.dataset.hudPhase,'ready');remove();assert.equal(observers[0].closed,true);assert.equal(queue.size,0);
 const reducedOwner=createHudAssembly({root:()=>root,timings:()=>timing,reduced:()=>true,raf:()=>{throw Error('No reduced motion animation');},caf:()=>{},animate:()=>{throw Error('No morph');}});
 const staticNodes=nodes(400);reducedOwner.register('static',staticNodes);reducedOwner.start();assert.equal(staticNodes.stage.dataset.hudPhase,'ready');assert.equal(root.dataset.hudState,'ready');reducedOwner.cancel();
});
test('preview session composition is bounded and decoration advances at the same rate across frame rates',()=>{
 const a=previewSession(()=>.1),b=previewSession(()=>.9);assert.notEqual(a.azimuth,b.azimuth);assert.equal(a.phases.length,8);assert.ok(a.elevation>.4&&b.elevation<.8);
 let x=0,y=0;for(let i=0;i<30;i++)x=previewStep(x,2,1/30,.012);for(let i=0;i<60;i++)y=previewStep(y,2,1/60,.012);assert.ok(Math.abs(x-y)<1e-12);assert.ok(previewStep(0,0,100,.012)<.002,'resume clamps hidden time');
});
