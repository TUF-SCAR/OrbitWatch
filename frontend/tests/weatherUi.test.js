import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Event } from 'cesium';
import { LIVE_EARTH_DEFAULTS } from '../src/data/liveEarthDefaults.js';
import { WEATHER_OPTIONS } from '../src/data/weatherOptions.js';
import { WEATHER_FIELDS } from '../src/services/weatherFields.js';
import { MAP_OPTIONS } from '../src/data/mapOptions.js';
import { weatherAltitudeAlpha, mountWeatherAltitudeFade } from '../src/services/weatherVisibility.js';
import { createTemperatureLayer } from '../src/services/temperatureLayer.js';
import { createCloudLayer } from '../src/services/cloudLayer.js';

test('Live Earth defaults select a configured-independent map and exactly the supported gallery fields',async()=>{
  assert.equal(LIVE_EARTH_DEFAULTS.mapStyle,'esri');assert.equal(LIVE_EARTH_DEFAULTS.weatherEnabled,true);
  assert.ok(MAP_OPTIONS.some(map=>map.id===LIVE_EARTH_DEFAULTS.mapStyle));
  assert.equal(LIVE_EARTH_DEFAULTS.weatherField,WEATHER_OPTIONS[0].id);
  assert.deepEqual(WEATHER_OPTIONS.map(option=>option.id).sort(),Object.keys(WEATHER_FIELDS).filter(id=>!WEATHER_FIELDS[id].hidden).sort());
  for(const option of WEATHER_OPTIONS){const svg=await readFile(new URL(`../public${option.preview}`,import.meta.url),'utf8');assert.match(svg,/<svg/);assert.doesNotMatch(svg,/<script|(?:href|src)=["']https?:/);}
});

test('weather altitude fade is continuous, monotonic and zero below 200km with no threshold toggles',()=>{
  assert.equal(weatherAltitudeAlpha(199999),0);assert.equal(weatherAltitudeAlpha(200000),0);
  assert.equal(weatherAltitudeAlpha(225000),.5);assert.equal(weatherAltitudeAlpha(250000),1);assert.equal(weatherAltitudeAlpha(27000000),1);
  let previous=0;
  for(let height=199000;height<=251000;height+=50){const next=weatherAltitudeAlpha(height);assert.ok(next>=previous&&next-previous<.002);previous=next;}
  for(const height of [199999,200001,199998,200002])assert.ok(weatherAltitudeAlpha(height)<1e-7);
  assert.equal(weatherAltitudeAlpha(NaN),1);
});

test('render-cycle altitude dispatch reaches late owners without touching selection and removes its listener',()=>{
  const preRender=new Event(),owners=[],viewer={camera:{positionCartographic:{height:190000}},scene:{preRender}};
  const remove=mountWeatherAltitudeFade(viewer,()=>owners);preRender.raiseEvent();
  const values=[];owners.push({setAltitudeAlpha:v=>values.push(v)});preRender.raiseEvent();
  viewer.camera.positionCartographic.height=225000;preRender.raiseEvent();viewer.camera.positionCartographic.height=260000;preRender.raiseEvent();
  assert.deepEqual(values,[0,.5,1]);remove();assert.equal(preRender.numberOfListeners,0);
});

function fixture(){
  const entries=[],preRender=new Event();let clock=0,builds=0;
  const viewer={isDestroyed:()=>false,scene:{globe:{atmosphereLightIntensity:10},preRender,requestRender(){}},imageryLayers:{contains:l=>entries.includes(l),addImageryProvider:provider=>{const layer={provider};entries.push(layer);return layer;},remove:layer=>entries.splice(entries.indexOf(layer),1)}};
  return {viewer,entries,now:()=>clock,makeProvider:()=>({build:++builds}),builds:()=>builds,tick(t){clock=t;preRender.raiseEvent();}};
}

test('modeled imagery altitude fade preserves opacity, provider and atmosphere through zoom and hidden loading',()=>{
  const f=fixture(),owner=createTemperatureLayer(f.viewer,{now:f.now,makeProvider:f.makeProvider,reduced:()=>false});
  owner.setAltitudeAlpha(0);owner.update({field:{id:'gfs'},visible:true,opacity:.6});f.tick(400);
  assert.equal(f.entries[0].alpha,0);assert.equal(f.viewer.scene.globe.atmosphereLightIntensity,10);
  owner.setAltitudeAlpha(.5);assert.equal(f.entries[0].alpha,.3);
  owner.setAltitudeAlpha(1);assert.equal(f.entries[0].alpha,.6);assert.equal(f.builds(),1);
  owner.setAltitudeAlpha(0);owner.update({field:{id:'gfs'},visible:true,opacity:.2});f.tick(800);assert.equal(f.entries[0].alpha,0);
  owner.setAltitudeAlpha(1);assert.equal(f.entries[0].alpha,.2);assert.equal(f.builds(),1);
  owner.update({visible:false,immediate:true});owner.setAltitudeAlpha(.5);assert.equal(f.entries.length,0);owner.destroy();
});

test('observed imagery crossfades and late frames respect altitude without losing frame or user opacity',async()=>{
  const f=fixture(),owner=createCloudLayer(f.viewer,{now:f.now,makeProvider:f.makeProvider,reduced:()=>false});
  owner.setAltitudeAlpha(0);await owner.update({frame:{id:'first'},visible:true,alpha:.6});f.tick(1000);assert.equal(f.entries[0].alpha,0);
  owner.setAltitudeAlpha(.5);assert.equal(f.entries[0].alpha,.3);
  await owner.update({frame:{id:'second'},visible:true,alpha:.6});f.tick(1300);assert.equal(f.entries.length,2);
  assert.ok(Math.abs(f.entries.reduce((sum,l)=>sum+l.alpha,0)-.3)<1e-9);
  owner.setAltitudeAlpha(0);assert.ok(f.entries.every(l=>l.alpha===0));f.tick(2000);owner.setAltitudeAlpha(1);
  assert.equal(f.entries.length,1);assert.equal(f.entries[0].alpha,.6);assert.equal(f.builds(),2);
  owner.destroy();assert.equal(f.entries.length,0);
});
