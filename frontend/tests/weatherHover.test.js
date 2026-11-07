import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleHoverWeather,weatherHoverBlocked,weatherHoverPosition,createWeatherHover} from '../src/services/weatherHover.js';

test('hover samples local physical units, with truthful precipitation period and no invented observed cloud fraction',()=>{
  const values=Array(65160).fill(27),temperature={values_c:values};
  assert.equal(sampleHoverWeather(temperature,0,0).text,'27°C');
  for(const [variable,value,text,units] of [['humidity',84,'84%','%'],['pressure',1011,'1011 hPa','hPa'],['precipitation',2.4,'2.4 mm/h','mm/h'],['clouds',75,'75%','%']]){
    const field={display_variable:variable,units,values:Array(65160).fill(value)};
    assert.equal(sampleHoverWeather(field,179.99,0).text,text);assert.equal(sampleHoverWeather(field,-180,0).value,sampleHoverWeather(field,180,0).value);
    field.values[90*360+180]=null;assert.equal(sampleHoverWeather(field,0,0),null);
  }
  assert.equal(sampleHoverWeather({display_variable:'precipitation',source_kind:'era5',values:Array(65160).fill(2.4)},0,0).text,'2.4 mm');
  assert.equal(sampleHoverWeather({display_variable:'observedClouds'},0,0),null);assert.equal(sampleHoverWeather(temperature,0,91),null);
});
test('satellites/events/other celestial bodies suppress weather without consuming or changing their picks',()=>{
  for(const properties of [{noradId:{}},{naturalEventId:{}},{celestialId:{getValue:()=> 'mars'}}])assert.equal(weatherHoverBlocked({id:{properties}}),true);
  assert.equal(weatherHoverBlocked({id:{orbitwatchEventCluster:true}}),true);
  assert.equal(weatherHoverBlocked({id:{properties:{celestialId:{getValue:()=> 'earth'}}}}),false);
  assert.equal(weatherHoverBlocked({id:{orbitwatchWeatherContour:true}}),false);
});
test('tooltip is edge-aware above/below the pointer on desktop and narrow screens',()=>{
  for(const width of [320,1440])for(const x of [0,20,width-1])for(const y of [0,20,500]){
    const p=weatherHoverPosition({x,y},width,600,100,40);
    assert.ok(p.x>=8&&p.x+100<=width-8);assert.ok(p.y>=8&&p.y+40<=592);assert.ok(p.pointer>=10&&p.pointer<=90);
    assert.equal(p.below,y<65);
  }
});
test('DOM hover coalesces pointer moves, uses latest coordinate, updates text only when changed and never requests data',()=>{
  const timers=new Map(),listeners=new Map();let next=0,reads=0,network=0,lastPoint;
  const originalFetch=globalThis.fetch;globalThis.fetch=()=>{network++;throw Error('Unexpected hover HTTP');};
  const bubble={hidden:true,dataset:{},style:{setProperty(){}},classList:{toggle(){}},offsetWidth:80,offsetHeight:40,setAttribute(){},remove(){this.removed=true;}};
  const canvas={clientWidth:1000,clientHeight:700,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const state={enabled:true,dragging:false,field:{values_c:Array(65160).fill(27)}};
  const owner=createWeatherHover({mount:{append(){}},canvas,doc:{createElement:()=>bubble},getState:()=>state,pickLocation:point=>{reads++;lastPoint=point;return {longitude:point.x/10,latitude:0};},schedule:fn=>{timers.set(++next,fn);return next;},cancel:id=>timers.delete(id)});
  const flush=()=>{const queued=[...timers.values()];timers.clear();queued.forEach(fn=>fn());};
  try{
    for(let i=0;i<100;i++)owner.move({x:i,y:200});assert.equal(timers.size,1);flush();
    assert.equal(reads,1);assert.equal(lastPoint.x,99);assert.equal(bubble.textContent,'27°C');assert.equal(bubble.hidden,false);
    owner.move({x:120,y:210});flush();assert.equal(owner.diagnostics().textUpdates,1);
    state.dragging=true;owner.move({x:130,y:220});flush();assert.equal(bubble.hidden,true);assert.equal(reads,2);
    state.dragging=false;owner.move({x:150,y:200},{id:{properties:{noradId:{}}}});flush();assert.equal(bubble.hidden,true);
    state.enabled=false;owner.move({x:160,y:200});flush();assert.equal(bubble.hidden,true);
    state.enabled=true;owner.move({x:170,y:200});listeners.get('pointerleave')();assert.equal(timers.size,0);assert.equal(bubble.hidden,true);
    assert.equal(network,0);owner.destroy();owner.destroy();assert.equal(listeners.size,0);assert.equal(bubble.removed,true);
  }finally{globalThis.fetch=originalFetch;owner.destroy();}
});
