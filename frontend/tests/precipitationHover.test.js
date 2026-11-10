import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPrecipitationHover} from '../src/services/precipitationHover.js';
import {sampleHoverWeather,createWeatherHover} from '../src/services/weatherHover.js';
import {precipitationAppearance} from '../src/services/precipitationHoverVisual.js';

test('dry sky conditions use cloud fraction with no forced numeric line',()=>{
  for(const [clouds,title] of [[0,'Sunny'],[10,'Sunny'],[11,'Mostly Sunny'],[30,'Mostly Sunny'],[31,'Partly Cloudy'],[70,'Partly Cloudy'],[71,'Cloudy'],[100,'Cloudy']]){
    const result=classifyPrecipitationHover(.05,{clouds});assert.equal(result.title,title);assert.equal(result.secondary,null);assert.ok(result.icon);
  }
  assert.equal(classifyPrecipitationHover(0).title,'No precipitation');
  assert.equal(classifyPrecipitationHover(0,{clouds:0,isDay:false}).title,'Clear');
});
test('explicit rain/snow phase uses stable intensity bands rather than exact example values',()=>{
  for(const [rate,title] of [[.1,'Sunshine & Showers'],[.3,'Very Light Rain'],[.5,'Light Rain'],[1.7,'Light Rain'],[2.5,'Moderate Rain'],[3,'Moderate Rain'],[7.5,'Heavy Rain'],[8,'Heavy Rain']]){
    const result=classifyPrecipitationHover(rate,{phase:'rain',clouds:50});assert.equal(result.title,title);assert.equal(result.secondary,`${rate} mm/h (Forecast)`);
  }
  for(const [rate,title] of [[2,'Light Snow'],[2.5,'Moderate Snow'],[22,'Moderate Snow'],[25,'Heavy Snow'],[33,'Heavy Snow']]){
    const result=classifyPrecipitationHover(rate,{phase:'snow'});assert.equal(result.title,title);assert.equal(result.secondary,`${rate} mm/h (Forecast)`);
  }
  assert.equal(classifyPrecipitationHover(1,{phase:null}).title,'Light Precipitation');
  assert.equal(classifyPrecipitationHover(NaN),null);assert.equal(classifyPrecipitationHover(-1),null);
});
test('sampling combines local cloud/explicit phase context and retains missing data and historical units',()=>{
  const field={display_variable:'precipitation',values:Array(65160).fill(0),fields:{clouds:{units:'%',values:Array(65160).fill(20)}}};
  assert.equal(sampleHoverWeather(field,0,0).text,'☀️ Mostly Sunny');
  field.values.fill(3);assert.equal(sampleHoverWeather(field,0,0).title,'Moderate Precipitation');
  field.precipitation_phase={values:Array(65160).fill('snow')};assert.equal(sampleHoverWeather(field,0,0).title,'Moderate Snow');
  assert.equal(sampleHoverWeather(field,-180,0).title,sampleHoverWeather(field,180,0).title);
  field.source_kind='era5';assert.equal(sampleHoverWeather(field,0,0).secondary,'3 mm (Preceding hour)');
  field.values[90*360+180]=null;assert.equal(sampleHoverWeather(field,0,0),null);
});
test('two-line precipitation DOM content stays local and uses the existing placement/suppression owner',()=>{
  const queue=new Map();let id=0;const listeners=new Map();
  const bubble={hidden:true,dataset:{},style:{setProperty(){}},classList:{toggle(){}},offsetWidth:220,offsetHeight:65,setAttribute(){},remove(){}};
  bubble.replaceChildren=(...children)=>{bubble.children=children;bubble.textContent=children.map(child=>child.textContent).join('\n');};
  let rootCreated=false;
  const doc={createElement(){if(!rootCreated){rootCreated=true;return bubble;}return {textContent:'',children:[],style:{setProperty(){}},setAttribute(){},append(child){this.children.push(child);this.textContent+=child.textContent;}};}};
  const state={enabled:true,field:{display_variable:'precipitation',values:Array(65160).fill(3)}};
  const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('No HTTP allowed');};
  const owner=createWeatherHover({mount:{append(){}},canvas:{clientWidth:320,clientHeight:600,addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)},doc,getState:()=>state,pickLocation:()=>({longitude:0,latitude:0}),schedule:fn=>{queue.set(++id,fn);return id;},cancel:key=>queue.delete(key)});
  const flush=()=>{const callbacks=[...queue.values()];queue.clear();callbacks.forEach(fn=>fn());};
  try{
    owner.move({x:10,y:200});flush();assert.equal(bubble.textContent,'Moderate Precipitation\n3 mm/h (Forecast)');assert.equal(bubble.children[0].children[0].className,'weather-hover__icon');assert.match(bubble.style.transform,/translate3d\(8px,/);
    owner.move({x:10,y:200},{id:{properties:{naturalEventId:{}}}});flush();assert.equal(bubble.hidden,true);
    state.dragging=true;owner.move({x:10,y:200});flush();assert.equal(bubble.hidden,true);
    state.dragging=false;state.enabled=false;owner.move({x:10,y:200});flush();assert.equal(bubble.hidden,true);
    state.enabled=true;state.field={values_c:Array(65160).fill(27)};owner.move({x:10,y:200});flush();assert.equal(bubble.textContent,'27°C');assert.equal(bubble.dataset.variable,'temperature');
  }finally{owner.destroy();globalThis.fetch=original;}
});

test('vector symbols and text colours distinguish intensity and explicit snow',()=>{
  for(const [rate,context,icon,color] of [
    [0,{clouds:0},'sun','#f5f7fa'],[0,{clouds:50},'partly','#f5f7fa'],[0,{clouds:100},'cloud','#f5f7fa'],
    [.1,{phase:'rain',clouds:50},'showers','#a8d5fa'],[1,{phase:'rain'},'rain-light','#a8d5fa'],
    [3,{phase:'rain'},'rain-moderate','#efc4e5'],[8,{phase:'rain'},'rain-heavy','#fff2a6'],
    [2,{phase:'snow'},'snow-light','#baf4f8'],[22,{phase:'snow'},'snow-moderate','#9feaf5'],[33,{phase:'snow'},'snow-heavy','#80dff4'],
  ]){
    const view=precipitationAppearance(classifyPrecipitationHover(rate,context));
    assert.equal(view.icon,icon);assert.equal(view.color,color);assert.match(view.image,/^url\("data:image\/svg\+xml,/);
    assert.doesNotMatch(decodeURIComponent(view.image),/<script|https?:\/\/(?!www.w3.org)/);
  }
  assert.equal(precipitationAppearance(classifyPrecipitationHover(33)).icon,'drop');
});
