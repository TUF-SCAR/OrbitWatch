import test from 'node:test';
import assert from 'node:assert/strict';
import {Ellipsoid,SceneMode} from 'cesium';
import {ADMIN1_LABELS,ADMIN1_SOURCE} from '../src/data/admin1Labels.js';
import {PLACE_LABEL_RECORDS,labelAltitudeRange,nearestSelectablePlace,customPlaceLabelsForMap} from '../src/services/placeLabelLayout.js';
import {createPlaceWeatherReadings} from '../src/services/placeLabelWeather.js';
import {createPlaceLabelLayer} from '../src/services/placeLabelLayer.js';
import {needsModelWeather} from '../src/services/weatherFields.js';

const stamp=Date.parse('2026-11-01T09:00:00Z'),nodes=value=>Array(65160).fill(value);
const place={id:'fixture-state',name:'Synthetic test province',kind:'state',longitude:10.5,latitude:20.5,rank:2,country:'Fixture country'};
function bundle() {
  return {id:'unit-fixture',grid:{width:360,height:181,west:-180,north:90,step:1},units:'°C',valid_at:new Date(stamp).toISOString(),retrieved_at:new Date(stamp).toISOString(),values_c:nodes(29.25),fields:{
    clouds:{units:'%',step_type:'instant',values:nodes(72)},precipitation:{units:'mm/h',step_type:'instant',values:nodes(.375)},
    humidity:{units:'%',step_type:'instant',grib_parameter:'RH',level:'2 m above ground',source_units:'%',values:nodes(64)},
    pressure:{units:'hPa',step_type:'instant',grib_parameter:'PRMSL',level:'mean sea level',source_units:'Pa',values:nodes(1012.4)},
    wind:{units:'m/s',step_type:'instant',u:nodes(3),v:nodes(-4)},
  }};
}
const context=data=>({bundle:data,variable:'temperature',windEnabled:false,enabled:true,compatible:true,mode:'live',freshness:'available',clock:stamp});

test('bundled real Admin-1 label points cover world regions with unique provider IDs and honest version metadata',()=>{
  assert.equal(ADMIN1_SOURCE.labels,4550);assert.equal(ADMIN1_LABELS.length,4550);
  assert.equal(new Set(ADMIN1_LABELS.map(row=>row[0])).size,4550);
  assert.equal(new Set(ADMIN1_LABELS.map(row=>row[6])).size,221);
  assert.equal(ADMIN1_SOURCE.source_records,ADMIN1_SOURCE.labels+ADMIN1_SOURCE.duplicate_points+1201);
  assert.equal(ADMIN1_SOURCE.portal_version,'5.1.0');assert.equal(ADMIN1_SOURCE.archive_version,'5.0.0-pre9');
  assert.equal(ADMIN1_SOURCE.sha256,'d39e236e2a0104427760a41a1a95714f3121a4d04339865a0c3910c3156a4bdb');
  for(const [id,name,lon,lat,rank,country,code] of ADMIN1_LABELS) {
    assert.match(id,/^[A-Z0-9]+-\d+$/);assert.ok(name&&country);assert.match(code,/^[A-Z0-9]{2,3}$/);assert.doesNotMatch(name,/^[A-Z0-9]{3}-(?:00|99)\b/);assert.ok(Number.isFinite(lon)&&Math.abs(lon)<=180);assert.ok(Number.isFinite(lat)&&Math.abs(lat)<=90);assert.ok(Number.isInteger(rank)&&rank>=2&&rank<=11);
  }
  for(const [name,code] of [['Telangana','IN'],['California','US'],['Ontario','CA'],['New South Wales','AU'],['São Paulo','BR'],['Bayern','DE'],['Gauteng','ZA'],['Guangdong','CN'],['Pohnpei','FM']]) {
    assert.ok(ADMIN1_LABELS.some(row=>row[1]===name&&row[6]===code),`${name} (${code}) from provider`);
  }
  assert.deepEqual(ADMIN1_LABELS.find(row=>row[0]==='USA-3521').slice(1),['California',-119.259235,36.357595,2,'United States of America','US']);
  assert.equal(PLACE_LABEL_RECORDS.filter(row=>row.kind==='state').length,4550);
  assert.ok(PLACE_LABEL_RECORDS.some(row=>row.kind==='country'));assert.ok(PLACE_LABEL_RECORDS.some(row=>row.kind==='city'));
  assert.ok(labelAltitudeRange('state',2)[1]>labelAltitudeRange('state',11)[1]);
  assert.ok(labelAltitudeRange('country',1)[1]>labelAltitudeRange('state',2)[1]);
});

test('text-bound snapping accepts long-name ends, multiline and 24px edges; rejects hidden/country/occluded and resolves ties deterministically',()=>{
  const long={...place,id:'b',name:'Visakhapatnam',x:200,y:100,width:180,height:55};
  assert.equal(nearestSelectablePlace([long],{x:314,y:100}).name,'Visakhapatnam');
  assert.equal(nearestSelectablePlace([long],{x:314.01,y:100}),null);
  assert.equal(nearestSelectablePlace([long],{x:200,y:151.5}).id,'b');
  assert.equal(nearestSelectablePlace([long],{x:200,y:151.51}),null);
  for(const excluded of [{visible:false},{occluded:true},{label:{show:false}},{kind:'country'}])assert.equal(nearestSelectablePlace([{...long,...excluded}],{x:200,y:100}),null);
  const actualHit={...long,id:'actual',x:300,width:200};
  assert.equal(nearestSelectablePlace([long,actualHit],{x:299,y:100}).id,'actual');
  const a={...long,id:'a'};assert.equal(nearestSelectablePlace([long,a],{x:200,y:100}).id,'a');
  assert.equal(nearestSelectablePlace([a,long],{x:200,y:100}).id,'a');
});

test('all primary variables sample the validated shared grid with correct units and independent U/V wind magnitude',()=>{
  const data=bundle(),weather=createPlaceWeatherReadings({now:()=>stamp});
  const expected={temperature:'29.3°C',observedClouds:'☁ 72%',precipitation:'Rate 0.38 mm/h',humidity:'Humidity 64%',pressure:'MSLP 1012.4 hPa'};
  for(const [variable,reading] of Object.entries(expected)) {
    weather.configure({...context(data),variable,windEnabled:true});assert.deepEqual(weather.get(place),[reading,'Wind 18 km/h']);
    assert.deepEqual(weather.get({...place,id:'country',kind:'country'}),[]);
  }
  weather.configure({...context(data),variable:'humidity'});assert.deepEqual(weather.get(place),['Humidity 64%']);
  const cloudOnly={...data,fields:{}};weather.configure({...context(cloudOnly),variable:'observedClouds'});
  assert.deepEqual(weather.get(place),[],'IR imagery never manufactures a fraction when GFS clouds are absent');
  assert.equal(needsModelWeather('observedClouds',false,false,true),true,'one existing bundle owner also supplies label clouds');
  assert.equal(needsModelWeather('observedClouds',false,false,false),false);
});

test('missing samples/optional fields, stale/expired bundles, mode, master and compatibility have honest fallbacks',()=>{
  let clock=stamp;const data=bundle(),weather=createPlaceWeatherReadings({now:()=>clock});
  const cfg=context(data);data.values_c[69*360+190]=null;
  weather.configure(cfg);assert.deepEqual(weather.get(place),[]);
  delete data.fields.humidity;weather.configure({...cfg,variable:'humidity',windEnabled:true});assert.deepEqual(weather.get(place),['Wind 18 km/h']);
  data.fields.pressure.source_units='hPa';weather.configure({...cfg,variable:'pressure'});assert.deepEqual(weather.get(place),[],'invalid optional provenance is omitted');
  for(const change of [{mode:'time'},{enabled:false},{compatible:false},{bundle:null},{freshness:'unavailable'}]) {
    weather.configure({...cfg,variable:'clouds',windEnabled:true,...change});assert.deepEqual(weather.get(place),[]);
  }
  weather.configure({...cfg,variable:'clouds',freshness:'stale'});assert.deepEqual(weather.get(place),['☁ 72% · cached']);
  weather.configure({...cfg,variable:'clouds'});assert.deepEqual(weather.get(place),['☁ 72%']);
  clock+=7*3600000;weather.configure({...cfg,variable:'clouds',clock});assert.deepEqual(weather.get(place),['☁ 72% · cached'],'freshness boundary invalidates even before hook notification');
  clock+=18*3600000;weather.configure({...cfg,variable:'clouds',clock});assert.deepEqual(weather.get(place),[],'hard expiry cannot retain old text');
});

test('one cached interpolation per place/control generation, no per-frame validation/sampling or external requests',t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('labels must never request point weather');});
  const weather=createPlaceWeatherReadings({now:()=>stamp}),cfg={...context(bundle()),windEnabled:true};weather.configure(cfg);weather.get(place);
  const first=weather.diagnostics();assert.equal(first.samples,3);
  for(let frame=1;frame<=300;frame++){assert.equal(weather.configure({...cfg,clock:stamp+frame*10}),false);weather.get(place);}
  assert.deepEqual(weather.diagnostics(),first);assert.equal(globalThis.fetch.mock.callCount(),0);
  weather.configure({...cfg,windEnabled:false});assert.deepEqual(weather.get(place),['29.3°C']);assert.equal(weather.diagnostics().samples,4);
});

function renderer(width=1600) {
  let base=0,shift=0,renderCount=0,measures=0;const labels=[],collection={show:true,add:label=>{labels.push(label);return label;},get length(){return labels.length;}};
  const scene={mode:SceneMode.SCENE2D,canvas:{clientWidth:width,clientHeight:1100},globe:{ellipsoid:Ellipsoid.WGS84},primitives:{add:()=>collection,remove:value=>assert.equal(value,collection)},requestRender:()=>renderCount++};
  const viewer={scene,camera:{positionCartographic:{height:1000000},positionWC:Ellipsoid.WGS84.cartographicToCartesian({longitude:0,latitude:0,height:1000000})}};
  const places=Array.from({length:180},(_,i)=>({...place,id:`state-${i}`,name:`Province ${i}`,index:i}));
  const weather=createPlaceWeatherReadings({now:()=>stamp});
  const layer=createPlaceLabelLayer(viewer,{places,weather,makeCollection:()=>collection,measure:{measureText:text=>{measures++;return {width:text.length*7,actualBoundingBoxAscent:10,actualBoundingBoxDescent:2};}},project:entry=>{
    const index=entry.index-base;if(index<0||index>=70)return null;return {x:80+(index%10)*145-shift,y:80+Math.floor(index/10)*100};
  }});
  return {layer,labels,weather,setBase:value=>{base=value;},setShift:value=>{shift=value;},counts:()=>({renderCount,measures})};
}

test('renderer reuses at most 45 three-line slots across pans and remeasures only on content changes',()=>{
  const view=renderer(),cfg={...context(bundle()),windEnabled:true};
  view.layer.update(0,true,'esri',cfg);assert.equal(view.layer.diagnostics().visible,45);assert.equal(view.labels.length,135);
  const initial=view.counts(),sampled=view.weather.diagnostics();
  for(let frame=1;frame<=90;frame++)view.layer.update(frame*20,true,'esri',cfg);
  assert.deepEqual(view.counts(),initial);assert.deepEqual(view.weather.diagnostics(),sampled);
  for(let pan=1;pan<=30;pan++){view.setBase(pan*3);view.layer.update(2000+pan*210,true,'esri',cfg);assert.equal(view.labels.length,135);assert.ok(view.layer.diagnostics().visible<=45);}
  view.layer.update(9000,true,'esri',{...cfg,mode:'time'});
  assert.ok(view.layer.diagnostics().places.every(entry=>entry.lines.length===1));assert.equal(view.labels.filter(label=>label.show).length,45);
  view.layer.update(9300,true,'osm',cfg);assert.equal(view.layer.diagnostics().visible,0);assert.equal(view.layer.pickLocation({x:80,y:80}),null);
  view.layer.update(9600,false,'esri',cfg);assert.equal(view.layer.diagnostics().visible,0);view.layer.destroy();
  for(const native of ['bing-labels','bing-road','osm','carto-dark','carto-voyager'])assert.equal(customPlaceLabelsForMap(native),false);
});

test('narrow layout remains bounded, includes measured multiline collision boxes and releases wind rows',()=>{
  const view=renderer(390),cfg={...context(bundle()),windEnabled:true};view.layer.update(0,true,'esri',cfg);
  assert.ok(view.layer.diagnostics().visible<=28);assert.ok(view.labels.length<=84);
  const first=view.layer.diagnostics().places[0];assert.equal(first.lines.length,3);
  assert.equal(view.layer.pickLocation({x:first.x+44,y:first.y+28}).id,first.id,'wind line and end-of-text remain selectable');
  view.setShift(140);assert.equal(view.layer.pickLocation({x:0,y:80}),null,'a fully clipped label cannot snap between camera-layout ticks');view.setShift(0);
  view.layer.update(300,true,'esri',{...cfg,windEnabled:false});assert.equal(view.layer.diagnostics().places[0].lines.length,2);
  assert.ok(view.labels.filter(label=>label.show).length<=56);view.layer.destroy();
});
