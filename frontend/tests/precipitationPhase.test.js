import test from 'node:test';
import assert from 'node:assert/strict';
import {Event,Cartesian3,Ellipsoid,TextureMagnificationFilter,TextureMinificationFilter} from 'cesium';
import {weatherPixels,selectWeatherField} from '../src/services/weatherFields.js';
import {phaseAtNodes,phaseNodes,phaseColor} from '../src/services/precipitationPhase.js';
import {precipitationAppearance} from '../src/services/precipitationHoverVisual.js';
import {createWeatherCompute} from '../src/services/weatherCompute.js';
import {createRainLayer} from '../src/services/rainLayer.js';
import {createTemperatureLayer} from '../src/services/temperatureLayer.js';
const time='2026-11-11T00:00:00Z';
function field(phase){return {valid_at:time,display_variable:'precipitation',units:'mm/h',step_type:'instant',values:Array(65160).fill(3),precipitation_phase:{valid_at:time,units:'category',level:'surface',step_type:'instant',values:Array(65160).fill(phase)}};}
test('the actual worker raster uses distinct phase palettes and preserves rain/unknown pixels',()=>{
  const pixels=new Map();
  for(const phase of ['rain','snow','freezing_rain','ice_pellets','mixed','unknown']){
    const f=field(phase);pixels.set(phase,[...weatherPixels(f,4,2).slice(0,4)]);
    assert.deepEqual(pixels.get(phase),phaseColor(3,phase));
    const appearance=precipitationAppearance({kind:phase,title:'Moderate Precipitation'});
    assert.ok(appearance.image);assert.match(appearance.image,/svg/);
  }
  assert.deepEqual(pixels.get('rain'),pixels.get('unknown'));
  assert.equal(new Set([...pixels.values()].map(p=>p.join(','))).size,5);
  const f=field('snow');f.precipitation_phase.valid_at='wrong';assert.deepEqual([...weatherPixels(f,4,2).slice(0,4)],pixels.get('rain'));
  f.source_kind='era5';assert.equal(phaseNodes(f),null);
});
test('categorical boundaries and worker transfer never discard or interpolate phase',async()=>{
  const f=field('rain');for(let y=0;y<181;y++)f.precipitation_phase.values[y*360+181]='snow';
  assert.equal(phaseAtNodes(phaseNodes(f),.49,0),'rain');assert.equal(phaseAtNodes(phaseNodes(f),.51,0),'snow');
  let sent;const worker={postMessage(job){sent=job;queueMicrotask(()=>worker.onmessage({data:{id:job.id,result:weatherPixels(job.field,job.width,job.height)}}));},terminate(){}};
  const owner=createWeatherCompute({makeWorker:()=>worker});
  const bundle={id:'fixture',valid_at:time,fields:{precipitation:{units:'mm/h',step_type:'instant',values:f.values}},precipitation_phase:f.precipitation_phase};
  const selected=selectWeatherField(bundle,'precipitation');await owner.raster(selected,4,2);
  assert.equal(sent.field.precipitation_phase,f.precipitation_phase);owner.destroy();
});
test('verified frozen and mixed cells never emit rainfall streaks; rain keeps the existing animation',()=>{
  const preRender=new Event(),moveEnd=new Event(),layers=[];let clock=100;
  const viewer={isDestroyed:()=>false,camera:{moveEnd,positionCartographic:{height:3000000},pickEllipsoid:()=>Cartesian3.fromDegrees(0,0)},scene:{canvas:{clientWidth:390,clientHeight:800},globe:{ellipsoid:Ellipsoid.WGS84},preRender,requestRender(){},primitives:{add(c){layers.push(c);return c;},remove(c){layers.splice(layers.indexOf(c),1);}}}};
  const owner=createRainLayer(viewer,{now:()=>clock,reduced:()=>false,doc:{hidden:false,addEventListener(){},removeEventListener(){}},makeCollection:()=>({add:options=>({...options})}),makeImage:()=> 'local-fixture'});
  for(const phase of ['snow','mixed','ice_pellets','freezing_rain','rain','unknown']){
    owner.update({field:field(phase),visible:true,quality:'performance'});
    for(let i=0;i<5;i++){clock+=100;preRender.raiseEvent();}
    assert.equal(owner.diagnostics().raining>0,['rain','unknown'].includes(phase));
  }
  owner.destroy();assert.equal(layers.length,0);
});

test('the globe imagery owner replaces scalar pixels when phase arrives and never GPU-blends category colours',()=>{
  const layers=[],preRender=new Event();let built=0;
  const viewer={isDestroyed:()=>false,scene:{preRender,requestRender(){},globe:{},skyAtmosphere:{}},imageryLayers:{contains:layer=>layers.includes(layer),addImageryProvider:provider=>{const layer={provider};layers.push(layer);return layer;},remove:layer=>{layers.splice(layers.indexOf(layer),1);}}};
  const owner=createTemperatureLayer(viewer,{makeProvider:f=>{built++;return {pixels:weatherPixels(f,4,2)};},reduced:()=>true});
  const snow={...field('snow'),id:'same-source-slot'},unknown={...snow,precipitation_phase:undefined};
  owner.update({field:unknown,visible:true});preRender.raiseEvent();const before=[...layers[0].provider.pixels.slice(0,4)];
  owner.update({field:snow,visible:true});preRender.raiseEvent();assert.equal(built,2);
  assert.notDeepEqual([...layers[0].provider.pixels.slice(0,4)],before);
  assert.equal(layers[0].magnificationFilter,TextureMagnificationFilter.NEAREST);assert.equal(layers[0].minificationFilter,TextureMinificationFilter.NEAREST);owner.destroy();
});
