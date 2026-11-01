import test from 'node:test';
import assert from 'node:assert/strict';
import {Cartesian3,Ellipsoid} from 'cesium';
import {pickEarthLocation,createSurfaceClickGate,routeEarthWeatherClick} from '../src/services/earthWeatherPicking.js';
import {nearestSelectablePlace} from '../src/services/placeLabelLayout.js';
import {createLocationWeatherSelection} from '../src/services/locationWeatherSelection.js';
import {createWeatherLocationMarker} from '../src/services/weatherLocationMarker.js';
import {weatherMeasurement,weatherCondition,weatherTime} from '../src/utils/weatherFormatters.js';
import {fetchLocationWeather} from '../src/services/orbitwatchApi.js';

function timers() {
  let clock=10000,id=0;const jobs=new Map();
  return {now:()=>clock,schedule:(fn,delay)=>{jobs.set(++id,{fn,at:clock+delay});return id;},cancel:key=>jobs.delete(key),jobs,
    async advance(ms){clock+=ms;const due=[...jobs].filter(([,job])=>job.at<=clock);for(const [key,job] of due){jobs.delete(key);job.fn();}await Promise.resolve();await Promise.resolve();},};
}
const response=selection=>({requested_latitude:selection.latitude,requested_longitude:selection.longitude,valid_at:'2026-11-01T12:00:00Z',values:{temperature_2m:0},units:{temperature_2m:'°C'}});

test('raster/terrain and verified Google tile depth resolve real Earth coordinates, never satellite depth',()=>{
  let depth=0,ground=Cartesian3.fromDegrees(-122.4,37.7,125),picked,depthPoint;
  const viewer={camera:{getPickRay:()=>({}),pickEllipsoid:()=>null},scene:{pickPositionSupported:true,pick:()=>picked,pickPosition:()=>{depth++;return depthPoint;},globe:{ellipsoid:Ellipsoid.WGS84,pick:()=>ground}}};
  const location=pickEarthLocation(viewer,{x:100,y:100});
  assert.ok(Math.abs(location.latitude-37.7)<1e-9);assert.ok(Math.abs(location.longitude+122.4)<1e-9);assert.ok(Math.abs(location.height-125)<.001);
  const tileset={show:true};picked={tileset};depthPoint=Cartesian3.fromDegrees(151.2,-33.8,50);
  assert.ok(Math.abs(pickEarthLocation(viewer,{x:100,y:100},tileset).latitude+33.8)<1e-9);assert.equal(depth,1);
  picked={id:{properties:{noradId:25544}}};depthPoint=Cartesian3.fromDegrees(10,10,410000);
  assert.ok(Math.abs(pickEarthLocation(viewer,{x:100,y:100},tileset).latitude-37.7)<1e-9);assert.equal(depth,1);
  ground=null;assert.equal(pickEarthLocation(viewer,{x:0,y:0}),null);
});

test('only visible city/state labels snap within 24 CSS px; country names never supply a location',()=>{
  const city={name:'Known city',kind:'city',x:100,y:100,latitude:10,longitude:20,label:{show:true}};
  const country={...city,name:'Country',kind:'country',x:123};
  assert.equal(nearestSelectablePlace([country,city],{x:124,y:100}).name,'Known city');
  assert.equal(nearestSelectablePlace([city],{x:124.01,y:100}),null);
  assert.equal(nearestSelectablePlace([{...city,label:{show:false}},country],{x:100,y:100}),null);
  assert.equal(nearestSelectablePlace([{...city,kind:'state'}],{x:100,y:100}).kind,'state');
});

test('event/celestial/satellite clicks retain priority; empty space clears weather and Follow stays owned by its target',()=>{
  const calls=[];let picked=null,event=false,location={latitude:10,longitude:20};
  const opts={eventPick:()=>event,pickObject:()=>picked,onCelestial:id=>calls.push(['body',id]),onSatellite:id=>calls.push(['satellite',id]),atEarth:true,following:true,eligible:()=>true,snap:()=>null,pickSurface:()=>location,onLocation:value=>calls.push(['location',value]),gate:{cancel(){},click:(_position,value)=>calls.push(['surface',value])}};
  const click=()=>routeEarthWeatherClick({x:10,y:20},opts);
  event=true;assert.equal(click(),'event');assert.equal(calls.filter(([type])=>type==='surface').length,0);
  event=false;picked={id:{properties:{celestialId:{getValue:()=> 'mars'}}}};assert.equal(click(),'celestial');assert.deepEqual(calls.at(-1),['body','mars']);
  picked={id:{properties:{noradId:{getValue:()=>25544}}}};assert.equal(click(),'satellite');assert.deepEqual(calls.at(-1),['satellite',25544]);
  picked=null;calls.length=0;assert.equal(click(),'surface');assert.deepEqual(calls,[['surface',location]],'surface inspection never releases Follow');
  location=null;assert.equal(click(),'empty');assert.deepEqual(calls.at(-1),['location',null]);
  opts.eligible=()=>false;assert.equal(click(),'ineligible');
});

test('one existing-handler click gate cancels drag/wheel/pinch and mouse/touch double-clicks, and ignores mode changes',async()=>{
  const t=timers(),selections=[];let eligible=true;
  const gate=createSurfaceClickGate({...t,onSelect:value=>selections.push(value),eligible:()=>eligible});
  const a={latitude:10,longitude:20};
  gate.click({x:10,y:20},a);gate.cancel(true);await t.advance(400);assert.deepEqual(selections,[]);
  gate.click({x:10,y:20},a);await t.advance(100);gate.click({x:12,y:21},a);await t.advance(400);assert.deepEqual(selections,[]);
  gate.click({x:10,y:20},a);gate.doubleClick();await t.advance(400);assert.deepEqual(selections,[]);
  gate.click({x:10,y:20},a);eligible=false;await t.advance(400);assert.deepEqual(selections,[]);
  eligible=true;gate.click({x:40,y:30},a);await t.advance(400);assert.deepEqual(selections,[a]);gate.destroy();assert.equal(t.jobs.size,0);
});

test('new selection immediately clears old readings; stale responses cannot update a newer name or coordinates',async()=>{
  const t=timers(),states=[],requests=[];
  const owner=createLocationWeatherSelection({...t,onChange:s=>states.push(s),fetchWeather:(latitude,longitude,signal)=>new Promise(resolve=>requests.push({latitude,longitude,signal,resolve}))});
  const a={name:'A',latitude:10,longitude:20},b={name:'B',latitude:-30,longitude:50};
  owner.select(a);assert.equal(states.at(-1).selection,a);await t.advance(250);
  owner.select(b);assert.equal(states.at(-1).selection,b);assert.equal(states.at(-1).data,null);assert.equal(requests[0].signal.aborted,true);
  requests[0].resolve(response(a));await Promise.resolve();assert.equal(states.at(-1).selection,b);assert.equal(states.at(-1).state,'loading');
  await t.advance(2100);requests[1].resolve(response(b));await Promise.resolve();await Promise.resolve();assert.equal(states.at(-1).data.requested_latitude,-30);
  owner.select(a);await t.advance(2100);owner.clear();assert.equal(requests[2].signal.aborted,true);requests[2].resolve(response(a));await Promise.resolve();assert.equal(states.at(-1).selection,null);
  owner.select(a);owner.destroy();await t.advance(10000);assert.equal(requests.length,3);
});

test('rapid points share one debounced request; 503 Retry-After is respected and mismatched coordinates stay unavailable',async()=>{
  const t=timers(),states=[],requests=[];
  const owner=createLocationWeatherSelection({...t,onChange:s=>states.push(s),fetchWeather:async(latitude,longitude)=>{requests.push([latitude,longitude]);throw Object.assign(Error(),{retryAfterSeconds:30});}});
  owner.select({latitude:1,longitude:2});owner.select({latitude:3,longitude:4});owner.select({latitude:5,longitude:6});await t.advance(250);
  assert.deepEqual(requests,[[5,6]]);assert.equal(states.at(-1).state,'unavailable');
  owner.retry();assert.equal(t.jobs.size,0);owner.select({latitude:7,longitude:8});await t.advance(1000);assert.equal(requests.length,1);owner.destroy();
  const wrong=createLocationWeatherSelection({...t,onChange:s=>states.push(s),fetchWeather:async()=>response({latitude:80,longitude:80})});wrong.select({latitude:0,longitude:0});await t.advance(250);assert.equal(states.at(-1).state,'unavailable');wrong.destroy();
});

test('one subtle selection marker updates in place and is removed on deselection',()=>{
  const entries=[];const viewer={entities:{add:entry=>{entries.push(entry);return entry;},remove:entry=>entries.splice(entries.indexOf(entry),1)},scene:{requestRender(){}}};
  const marker=createWeatherLocationMarker(viewer);marker.update({latitude:10,longitude:20});const first=entries[0];marker.update({latitude:11,longitude:21});assert.equal(entries.length,1);assert.equal(entries[0],first);assert.equal(first.properties.weatherLocation,true);marker.update(null);assert.equal(entries.length,0);marker.destroy();
});

test('weather content retains zero, missing values, valid UTC time and km/h semantics',()=>{
  const data={values:{temperature_2m:0,wind_speed_10m:10,pressure_msl:null},units:{temperature_2m:'°C',wind_speed_10m:'m/s',pressure_msl:'hPa'}};
  assert.equal(weatherMeasurement(data,'temperature_2m'),'0 °C');assert.equal(weatherMeasurement(data,'wind_speed_10m'),'36 km/h');assert.equal(weatherMeasurement(data,'pressure_msl'),'Unavailable');assert.equal(weatherMeasurement(data,'relative_humidity_2m'),'Unavailable');assert.equal(weatherCondition(0),'Clear');assert.match(weatherTime('2026-11-01T12:30:00Z'),/12:30 UTC/);
});

test('location HTTP 503 retains Retry-After for the shared selection owner',async context=>{
  context.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({detail:'Weather cooling down'}),{status:503,headers:{'Retry-After':'42','Content-Type':'application/json'}}));
  await assert.rejects(fetchLocationWeather(10,20,new AbortController().signal),error=>error.status===503&&error.retryAfterSeconds===42);
});
