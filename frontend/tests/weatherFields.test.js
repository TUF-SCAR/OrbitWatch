import assert from 'node:assert/strict';
import test from 'node:test';
import { Event } from 'cesium';
import {createWeatherPresentation} from '../src/services/weatherPresentation.js';
import {selectWeatherField,sampleModel,weatherPixels,drawWindVectors,validateModelField} from '../src/services/weatherFields.js';
import {createNaturalEventLayer} from '../src/services/naturalEventLayer.js';

test('weather presentation reduces scattering only, retains all atmosphere/shading flags and restores the exact prior intensity',()=>{
  for(const initial of [true,false]){
    const scene={globe:{showGroundAtmosphere:initial,atmosphereLightIntensity:7.25,enableLighting:true},skyAtmosphere:{show:true},fog:{enabled:true}};
    const owner=createWeatherPresentation(scene);owner.set(true);owner.set(true);
    assert.equal(scene.globe.showGroundAtmosphere,initial);assert.equal(scene.globe.atmosphereLightIntensity,1);assert.equal(scene.globe.enableLighting,true);assert.equal(scene.skyAtmosphere.show,true);assert.equal(scene.fog.enabled,true);
    owner.set(false);assert.equal(scene.globe.atmosphereLightIntensity,7.25);owner.set(true);owner.destroy();assert.equal(scene.globe.atmosphereLightIntensity,7.25);
  }
});
test('real model fields preserve units/missing nodes/dateline and wind arrows follow east/north components',()=>{
  const values=Array(65160).fill(70),u=Array(65160).fill(10),v=Array(65160).fill(0);
  const bundle={id:'fixture',grid:{width:360,height:181,west:-180,north:90,step:1},fields:{
    clouds:{units:'%',step_type:'instant',values},precipitation:{units:'mm/h',step_type:'instant',values:Array(65160).fill(.3)},wind:{units:'m/s',step_type:'instant',u,v}}};
  assert.equal(selectWeatherField(bundle,'temperature'),bundle);assert.equal(selectWeatherField({...bundle,fields:null},'clouds'),null);
  for(const key of ['clouds','precipitation','wind'])assert.equal(weatherPixels(selectWeatherField(bundle,key),36,18).length,2592);
  assert.equal(sampleModel(values,-180,0),sampleModel(values,180,0));
  values[90*360+180]=null;assert.equal(sampleModel(values,0,0),null);
  assert.throws(()=>validateModelField('clouds',{units:'%',step_type:'avg',values}));
  const moves=[],lines=[],context={beginPath(){},moveTo(x,y){moves.push([x,y]);},lineTo(x,y){lines.push([x,y]);},stroke(){}};
  drawWindVectors(context,bundle.fields.wind,720,360);
  assert.ok(lines[0][0]>moves[0][0]);assert.equal(lines[0][1],moves[0][1]);
  bundle.fields.wind.u=Array(65160).fill(0);bundle.fields.wind.v=u;moves.length=0;lines.length=0;
  drawWindVectors(context,bundle.fields.wind,720,360);assert.equal(lines[0][0],moves[0][0]);assert.ok(lines[0][1]<moves[0][1]);
});

test('event layer owns two bounded data sources; clustering/selection consumes clicks without touching satellite selection, and all resources are released',async()=>{
  const sources=[],preRender=new Event();let selected=null,removed=0,calm=false,clock=0;
  const viewer={isDestroyed:()=>false,scene:{preRender,requestRender(){}},dataSources:{add(ds){sources.push(ds);return Promise.resolve(ds);},remove(ds,destroy){assert.equal(destroy,true);const i=sources.indexOf(ds);if(i>=0){sources.splice(i,1);removed++;}return i>=0;}}};
  const owner=createNaturalEventLayer(viewer,{makeIcon:(_category,frame=0)=> `fixture-icon-${frame}`,now:()=>clock,makeClusterIcon:count=>`count-${count}`,onSelect:id=>{selected=id;},reduced:()=>calm});
  const events=Array.from({length:600},(_,i)=>({id:`provider:${i}`,title:`Reported ${i}`,category:i===0?'cyclone':'earthquake',reported_at:'2026-10-23T12:00:00Z',position:[i%360-180,i%170-85],geometry:{type:'Point'}}));
  owner.update({events,visible:false});owner.update({events,visible:true});assert.equal(sources.length,2);assert.equal(sources[0].entities.values.length,600);
  assert.equal(sources[0].clustering.enabled,true);const original=sources[0].entities.values[1];
  const cluster={billboard:{},label:{},point:{}};sources[0].clustering.clusterEvent.raiseEvent(events.slice(0,5),cluster);
  assert.equal(cluster.billboard.image,'count-5');assert.equal(cluster.billboard.disableDepthTestDistance,0);
  assert.equal(cluster.label.show,false);assert.equal(cluster.point.show,false);assert.equal(owner.pick({id:cluster.billboard.id}),true);
  owner.update({events,visible:true,selectedId:'provider:0'});assert.equal(sources[0].entities.values[1],original);assert.equal(preRender.numberOfListeners,1);
  assert.equal(sources[1].entities.values.length,1);assert.equal(sources[0].entities.values[0].show,false);
  clock=5000;preRender.raiseEvent();assert.ok(Math.abs(sources[1].entities.values[0].billboard.rotation.getValue()-5000/24000*Math.PI*2)<1e-9);assert.equal(sources[1].entities.values[0].billboard.image.getValue(),'fixture-icon-0');
  calm=true;clock=9000;preRender.raiseEvent();assert.equal(sources[1].entities.values[0].billboard.rotation.getValue(),0);assert.equal(sources[1].entities.values[0].billboard.scale.getValue(),1);
  assert.equal(owner.pick({id:sources[1].entities.values[0]}),true);assert.equal(selected,'provider:0');
  assert.equal(owner.pick({id:{orbitwatchEventCluster:true}}),true);assert.equal(owner.pick({id:{properties:{noradId:25544}}}),false);
  const revision=events.map((e,i)=>i===0?{...e,title:'Revised source title at the same report time',geometry:{type:'Point',coordinates:e.position}}:e);
  owner.update({events:revision,visible:true,selectedId:'provider:0'});assert.equal(sources[1].entities.values[0].label.text.getValue(),'Revised source title at the same report time');
  owner.update({events,visible:false,selectedId:'provider:0'});assert.equal(preRender.numberOfListeners,0);assert.equal(sources[0].entities.values.length,0);
  owner.update({events,visible:true,category:'cyclone',selectedId:'provider:0'});assert.equal(sources[0].entities.values.length,1);
  owner.destroy();owner.destroy();await Promise.resolve();assert.equal(sources.length,0);assert.equal(removed,2);assert.equal(preRender.numberOfListeners,0);
});

test('a selected cyclone with reduced motion starts no animation listener',async()=>{
  const sources=[],preRender=new Event();const viewer={isDestroyed:()=>false,scene:{preRender,requestRender(){}},dataSources:{add(ds){sources.push(ds);return Promise.resolve(ds);},remove(ds){sources.splice(sources.indexOf(ds),1);}}};
  const owner=createNaturalEventLayer(viewer,{makeIcon:()=> 'calm',reduced:()=>true});
  owner.update({events:[{id:'fixture',title:'Clearly synthetic unit fixture',category:'cyclone',reported_at:'2026-10-23T12:00:00Z',position:[10,20],geometry:{type:'Point'}}],visible:true,selectedId:'fixture'});
  assert.equal(preRender.numberOfListeners,0);assert.equal(owner.diagnostics().animated,false);
  owner.update({events:[{id:'fixture',title:'Synthetic reported-extent unit fixture',category:'flood',position:[179,10],geometry:{type:'Polygon',coordinates:[[[179,10],[-179,10],[-179,12],[179,10]]]}}],visible:true,selectedId:'fixture'});
  assert.equal(sources[1].entities.values.length,2);assert.equal(owner.pick({id:sources[1].entities.values[1]}),true);assert.equal(sources[1].entities.values[1].properties.naturalEventId.getValue(),'fixture');
  owner.destroy();await Promise.resolve();assert.equal(sources.length,0);
});
