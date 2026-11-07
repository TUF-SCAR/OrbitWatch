import test from 'node:test';
import assert from 'node:assert/strict';
import {Cartesian3,Ellipsoid,Event} from 'cesium';
import {pressureContours,pressureExtrema,splitAntimeridian,selectPressureLabels,pressureInterval} from '../src/services/pressureContours.js';
import {createPressureLayer,PRESSURE_BUDGET} from '../src/services/pressureLayer.js';
import {sampleModel} from '../src/services/weatherFields.js';

const plane=(width,height,fn)=>({grid:{width,height,west:0,north:height-1,step:1},values:Array.from({length:width*height},(_,i)=>fn(i%width,Math.floor(i/width)))});
function globalField(fn){return {id:'scientific-unit-fixture',display_variable:'pressure',units:'hPa',source_units:'Pa',grib_parameter:'PRMSL',level:'mean sea level',step_type:'instant',grid:{width:360,height:181,west:-180,north:90,step:1},values:Array.from({length:65160},(_,i)=>fn(i%360-180,90-Math.floor(i/360)))};}

test('isobars interpolate the known planar solution and stitch every adjoining cell',()=>{
  const contours=pressureContours(plane(4,5,(x)=>1000+x*3),{wrap:false});
  const line=contours.find(contour=>contour.level===1004);
  assert.equal(line.points.length,5);
  for(const [longitude] of line.points)assert.ok(Math.abs(longitude-4/3)<1e-10);
  assert.deepEqual(line.points.map(point=>point[1]).sort((a,b)=>a-b),[0,1,2,3,4]);
});
test('bilinear saddle decider keeps the correct connected region without crossing lines',()=>{
  const saddle=plane(2,2,(x,y)=>x===y?1006:999);
  const contours=pressureContours(saddle,{wrap:false,interval:1000});
  assert.equal(contours.length,2);
  assert.ok(contours.some(({points})=>points.some(([x])=>x===1)&&points.some(([,y])=>y===1)));
  saddle.values=[1001,994,994,1001];
  const inverse=pressureContours(saddle,{wrap:false,interval:1000});
  assert.ok(inverse.some(({points})=>points.some(([x])=>x===0)&&points.some(([,y])=>y===1)));
});
test('missing pressure cells break contours and uniform plateaus produce no lines or extrema',()=>{
  const field=plane(5,7,x=>1000+x*2);field.values[3*5+2]=null;
  const lines=pressureContours(field,{wrap:false}).filter(contour=>contour.level===1004);
  assert.equal(lines.length,2);
  assert.ok(lines.every(line=>line.points.every(point=>point[1]>=4)||line.points.every(point=>point[1]<=2)));
  const flat=globalField(()=>1013);assert.deepEqual(pressureContours(flat),[]);assert.deepEqual(pressureExtrema(flat),[]);
});
test('periodic longitude stitching splits date-line contours with identical seam latitudes and no long chords',()=>{
  const field=globalField((lon,lat)=>{const x=Math.min(Math.abs(lon-179),360-Math.abs(lon-179));return Math.max(980,1016-x*x-lat*lat);});
  const contours=pressureContours(field).filter(line=>line.level===1004);
  assert.ok(contours.length>=2);
  const east=[],west=[];
  for(const {points} of contours)for(let i=0;i<points.length;i++){
    if(points[i][0]===180)east.push(points[i][1]);if(points[i][0]===-180)west.push(points[i][1]);
    if(i)assert.ok(Math.abs(points[i][0]-points[i-1][0])<=180);
  }
  assert.deepEqual(east.sort(),west.sort());assert.ok(east.length>0);
  assert.deepEqual(splitAntimeridian([[179,10],[-179,12]]),[[[179,10],[180,11]],[[-180,11],[-179,12]]]);
});
test('H/L require a genuine strict regional extremum and valid surrounding nodes',()=>{
  for(const sign of [1,-1]){
    const field=globalField((lon,lat)=>{const x=Math.min(Math.abs(lon-179),360-Math.abs(lon-179));return 1013+sign*20*Math.exp(-(x*x+lat*lat)/12);});
    const extrema=pressureExtrema(field);assert.equal(extrema.length,1);assert.equal(extrema[0].type,sign===1?'H':'L');
    assert.equal(extrema[0].longitude,179);assert.equal(extrema[0].latitude,0);
    field.values[90*360+358]=null;assert.deepEqual(pressureExtrema(field),[]);
  }
  assert.deepEqual(pressureExtrema(globalField((lon,lat)=>1013+lat*.1)),[]);
});
test('curved contour refinement remains on the real bilinear pressure surface',()=>{
  const field=globalField((lon,lat)=>1013+12*Math.cos(lon*Math.PI/180)*Math.cos(lat*Math.PI/180));
  const contours=pressureContours(field);
  for(const {level,points} of contours)for(const [lon,lat] of points)assert.ok(Math.abs(sampleModel(field.values,lon,lat)-level)<1e-7);
});
test('screen-space contour labels collide neither with each other nor viewport edges; distant views thin intervals',()=>{
  const accepted=selectPressureLabels([{x:100,y:100},{x:110,y:105},{x:250,y:100},{x:1,y:10}],400,200);
  assert.equal(accepted.length,2);assert.equal(pressureInterval(2e6),4);assert.equal(pressureInterval(12e6),8);assert.equal(pressureInterval(20e6),16);
});
test('pressure owner reuses contours for camera/opacity/altitude changes and fully releases both collections/listeners',()=>{
  const preRender=new Event(),primitives=[],destroyedMaterials=new Set();
  const viewer={isDestroyed:()=>false,camera:{positionWC:Cartesian3.fromDegrees(0,0,1e7),positionCartographic:{height:2e6}},scene:{globe:{ellipsoid:Ellipsoid.WGS84},canvas:{clientWidth:1000,clientHeight:700},preRender,requestRender(){},primitives:{add(item){primitives.push(item);return item;},remove(item){for(const line of item.items)line.material?.destroy();primitives.splice(primitives.indexOf(item),1);return true;}}}};
  const collection=()=>({show:true,items:[],add(options){this.items.push(options);return options;}});
  let clock=0;
  const makeMaterial=()=>({uniforms:{},destroy(){assert.equal(destroyedMaterials.has(this),false,'each polyline must own its material');destroyedMaterials.add(this);}});
  const owner=createPressureLayer(viewer,{makeLines:collection,makeLabels:collection,makeMaterial,isVisible:()=>true,now:()=>clock,project:()=>({x:400,y:300})});
  const field=globalField((lon,lat)=>1013+10*Math.cos(lon*Math.PI/180)*Math.cos(lat*Math.PI/180));
  owner.update({field,visible:true});assert.equal(primitives.length,2);preRender.raiseEvent();
  assert.ok(owner.diagnostics().paths>0);assert.ok(owner.diagnostics().paths<=PRESSURE_BUDGET.paths);
  owner.update({field,visible:true,opacity:.3});clock=200;preRender.raiseEvent();assert.equal(owner.diagnostics().builds,1);
  owner.setAltitudeAlpha(0);assert.ok(primitives.every(item=>!item.show));owner.setAltitudeAlpha(1);assert.ok(primitives.every(item=>item.show));
  assert.ok(owner.diagnostics().labels<=PRESSURE_BUDGET.labels);
  owner.update({field,visible:true,compatible:false});assert.equal(primitives.length,0);assert.equal(preRender.numberOfListeners,0);
  owner.destroy();owner.destroy();assert.equal(primitives.length,0);
});
