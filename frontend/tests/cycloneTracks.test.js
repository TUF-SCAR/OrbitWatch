import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {Cartesian3,Event} from 'cesium';
import {trackPoints,trackSegments,datedPointSubset,eventFilter,windColor} from '../src/services/cycloneTracks.js';
import {createNaturalEventLayer} from '../src/services/naturalEventLayer.js';
const genuine=JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/ibtracs_v4r01_track_excerpt.json',import.meta.url),'utf8'));

test('authentic NOAA excerpt retains dated original agency positions and conventions',()=>{
  for(const event of genuine.events){
    const points=trackPoints(event.track);assert.ok(points.length>2);assert.equal(points.length,event.track.observed.length);
    assert.equal(trackPoints(event.track,'forecast').length,0);
    assert.ok(points.every(p=>'OIV'.includes(p.interpolation_flag)));assert.ok(datedPointSubset(points,8).length<=9);
  }
  const across=[{longitude:179,latitude:12,at:'2026-10-26T00:00:00Z'},{longitude:-179,latitude:12,at:'2026-10-26T06:00:00Z'}];
  const segments=trackSegments(across);assert.equal(segments.length,1);
  assert.ok(Cartesian3.distance(...across.map(p=>Cartesian3.fromDegrees(p.longitude,p.latitude)))<250000);
  assert.equal(trackSegments([across[0],{...across[1],at:'2026-10-30T06:00:00Z'}]).length,0);
});
test('forecast validity is strict and does not create observed points or intensity categories',()=>{
  const now=Date.now(),issued=new Date(now-60000).toISOString(),expires=new Date(now+3600000).toISOString();
  const point={at:new Date(now+1800000).toISOString(),longitude:10,latitude:20,issued_at:issued,classification:'forecast',wind:100,wind_units:'kt',wind_averaging_minutes:10};
  const track={issued_at:issued,expires_at:expires,observed:[],forecast:[point]};
  assert.equal(trackPoints(track,'forecast',now).length,1);assert.equal(trackPoints(track,'observed',now).length,0);
  assert.equal(trackPoints({...track,expires_at:'invalid'},'forecast',now).length,0);
  assert.equal(trackPoints({...track,expires_at:new Date(now-1).toISOString()},'forecast',now).length,0);
  assert.equal(windColor(point),'#a9dedf');assert.notEqual(windColor({...point,wind_averaging_minutes:1}),'#a9dedf');
});
test('selected tracks use solid/dashed paths, stable resources, explicit focus/restore and no forecast motion',async()=>{
  const sources=[],preRender=new Event(),flights=[],restores=[];
  const camera={positionWC:Cartesian3.fromDegrees(10,20,20000000),directionWC:new Cartesian3(0,0,-1),upWC:new Cartesian3(0,1,0),
    flyToBoundingSphere:(sphere,options)=>flights.push({sphere,options}),lookAtTransform(){},setView:options=>restores.push(options),cancelFlight(){}};
  const viewer={camera,isDestroyed:()=>false,scene:{preRender,requestRender(){}},dataSources:{add(ds){sources.push(ds);return Promise.resolve(ds);},remove(ds){sources.splice(sources.indexOf(ds),1);}}};
  const owner=createNaturalEventLayer(viewer,{makeIcon:()=> 'isolated-icon',makeClusterIcon:()=> 'cluster',reduced:()=>true});
  const event=structuredClone(genuine.events[0]);
  const now=Date.now();event.track.issued_at=new Date(now-60000).toISOString();event.track.expires_at=new Date(now+3600000).toISOString();
  event.track.forecast=[1,2].map(h=>({at:new Date(now+h*3600000).toISOString(),issued_at:event.track.issued_at,longitude:130+h,latitude:20,classification:'forecast',wind:null}));
  owner.update({events:[event],visible:true,selectedId:event.id});assert.equal(flights.length,0);assert.equal(preRender.numberOfListeners,0);
  const paths=sources[1].entities.values.filter(e=>e.polyline);assert.ok(paths.some(e=>e.polyline.material.getType()==='PolylineGlow'));assert.ok(paths.some(e=>e.polyline.material.getType()==='PolylineDash'));
  const first=paths[0];owner.update({events:[event],visible:true,selectedId:event.id});assert.ok(sources[1].entities.values.includes(first));
  assert.equal(owner.focusEvent(event.id),true);assert.equal(flights.length,1);assert.equal(flights[0].options.duration,0);
  assert.equal(owner.returnFromFocus(),true);assert.equal(restores.length,1);assert.equal(owner.returnFromFocus(),false);
  assert.ok(sources[1].entities.values.some(e=>e.properties?.sourceTimestamp?.getValue()));
  owner.update({events:[event],visible:false});assert.equal(sources[1].entities.values.length,0);owner.destroy();await Promise.resolve();assert.equal(sources.length,0);
});
test('polygons show boundary geometry without an arbitrary vertex icon; filters distinguish old/stale and current reports',()=>{
  const sources=[];const viewer={isDestroyed:()=>false,scene:{preRender:new Event(),requestRender(){}},dataSources:{add(ds){sources.push(ds);return Promise.resolve(ds);},remove(ds){sources.splice(sources.indexOf(ds),1);}}};
  const owner=createNaturalEventLayer(viewer,{makeIcon:()=> 'fixture',reduced:()=>true});
  const old={...genuine.events[0],id:'isolated:polygon',position:null,category:'flood',reported_at:'2020-01-01T00:00:00Z',last_report_at:'2020-01-01T00:00:00Z',data_state:'stale',geometry:{type:'Polygon',coordinates:[[[179,10],[-179,10],[-179,12],[179,12],[179,10]]]}};
  owner.update({events:[old],visible:true,selectedId:old.id});assert.ok(sources[0].entities.values.every(e=>!e.billboard));assert.ok(sources[1].entities.values.some(e=>e.polyline));
  assert.equal(eventFilter([old],{status:'older'}).length,1);assert.equal(eventFilter([old],{status:'fresh'}).length,0);assert.equal(eventFilter([old],{category:'cyclone'}).length,0);owner.destroy();
});
