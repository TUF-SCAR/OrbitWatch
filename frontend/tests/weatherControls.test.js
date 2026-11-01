import assert from 'node:assert/strict';
import test from 'node:test';
import {Cartesian3,Event} from 'cesium';
import {selectWeatherField,needsModelWeather,weatherPixels,sampleModel,WEATHER_FIELDS} from '../src/services/weatherFields.js';
import {temperatureResult} from '../src/services/weatherPolling.js';
import {createTemperatureLayer} from '../src/services/temperatureLayer.js';
import {createWindLayer} from '../src/services/windLayer.js';
import {createCloudLayer} from '../src/services/cloudLayer.js';

function bundle() {
  return {id:'synthetic-control-test',units:'°C',grid:{width:360,height:181,west:-180,north:90,step:1},valid_at:'2026-11-01T06:00:00Z',values_c:Array(65160).fill(20),fields:{
    wind:{units:'m/s',step_type:'instant',u:Array(65160).fill(10),v:Array(65160).fill(-3)},
    clouds:{units:'%',step_type:'instant',values:Array(65160).fill(50)},
    precipitation:{units:'mm/h',step_type:'instant',values:Array(65160).fill(2)},
    humidity:{units:'%',source_units:'%',grib_parameter:'RH',level:'2 m above ground',step_type:'instant',values:Array(65160).fill(70)},
    pressure:{units:'hPa',source_units:'Pa',grib_parameter:'PRMSL',level:'mean sea level',step_type:'instant',values:Array(65160).fill(1013.25)},
  }};
}
test('optional humidity/pressure retain missing nodes, source identity and units without invalidating core data',()=>{
  const source=bundle();
  for(const key of ['humidity','pressure']) {
    const field=selectWeatherField(source,key);
    assert.equal(weatherPixels(field,36,18).length,2592);
    assert.equal(sampleModel(field.values,-180,0),sampleModel(field.values,180,0));
    field.values[90*360+180]=null;assert.equal(sampleModel(field.values,0,0),null);
  }
  const wrong={...source,fields:{...source.fields,pressure:{...source.fields.pressure,source_units:'hPa'},humidity:{...source.fields.humidity,level:'surface'}}};
  const result=temperatureResult(wrong).field;
  assert.equal(selectWeatherField(result,'pressure'),null);assert.equal(selectWeatherField(result,'humidity'),null);
  assert.ok(result.fields.wind);assert.ok(result.values_c);assert.ok(wrong.fields.pressure,'input bundle remains unchanged');
  delete source.fields.humidity;delete source.fields.pressure;
  assert.ok(temperatureResult(source).field.fields.wind);
  assert.equal(WEATHER_FIELDS.wind.units,'km/h');
});

test('wind overlays observed clouds and every primary field; toggling wind releases only its own resources',async()=>{
  const source=bundle(),imagery=[],primitives=[],timers=new Set(),preRender=new Event();
  const target={addEventListener(){},removeEventListener(){}};
  const viewer={isDestroyed:()=>false,camera:{positionCartographic:{height:27000000},pickEllipsoid:()=>Cartesian3.fromDegrees(70,10)},scene:{canvas:{...target,clientWidth:1000,clientHeight:700},globe:{atmosphereLightIntensity:10},preRender,requestRender(){},primitives:{add(p){primitives.push(p);return p;},remove(p){primitives.splice(primitives.indexOf(p),1);}}},imageryLayers:{contains:p=>imagery.includes(p),addImageryProvider:provider=>{const layer={provider};imagery.push(layer);return layer;},remove:p=>imagery.splice(imagery.indexOf(p),1)}};
  const cloud=createCloudLayer(viewer,{makeProvider:()=>({observed:true}),reduced:()=>true});
  const primary=createTemperatureLayer(viewer,{makeProvider:field=>({id:field.id}),reduced:()=>true});
  const wind=createWindLayer(viewer,{doc:{...target,hidden:false},media:{...target,matches:false},schedule:fn=>{timers.add(fn);return fn;},cancel:fn=>timers.delete(fn),makePrimitive:n=>({data:new Float32Array(n*8)})});
  await cloud.update({frame:{id:'observed-test'},visible:true,alpha:.55});preRender.raiseEvent();
  const observed=imagery[0],windField=selectWeatherField(source,'wind');
  assert.equal(needsModelWeather('observedClouds',false,false),false);
  assert.equal(needsModelWeather('observedClouds',false,true),true);
  const options={field:windField,visible:true,compatible:true,quality:'balanced',opacity:.55};
  wind.update(options);const particle=primitives[0];assert.equal(timers.size,1);assert.equal(imagery[0],observed);
  wind.update({...options,visible:false});assert.equal(primitives.length,0);assert.equal(timers.size,0);assert.equal(imagery[0],observed);
  wind.update(options);const secondParticle=primitives[0];assert.notEqual(secondParticle,particle);
  await cloud.update({visible:false,immediate:true});preRender.raiseEvent();
  for(const variable of ['temperature','precipitation','humidity','pressure']) {
    primary.update({field:selectWeatherField(source,variable),visible:true,compatible:true,opacity:.55});preRender.raiseEvent();
    wind.update(options);assert.equal(primitives[0],secondParticle);assert.equal(primitives.length,1);assert.equal(timers.size,1);
  }
  const underlying=imagery.at(-1);
  wind.update({...options,visible:false});assert.ok(imagery.includes(underlying));assert.equal(primitives.length,0);assert.equal(timers.size,0);
  wind.update(options);
  primary.update({visible:false,compatible:false});wind.update({...options,compatible:false});
  assert.equal(imagery.length,0);assert.equal(primitives.length,0);assert.equal(timers.size,0);
  wind.destroy();cloud.destroy();primary.destroy();assert.equal(preRender.numberOfListeners,0);
});
