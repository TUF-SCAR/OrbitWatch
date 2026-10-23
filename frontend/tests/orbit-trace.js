// Development-only review surface. Production geometry/material/transform owners;
// recorded real SGP4 samples, no new provider requests or account changes.
import {BoundingSphere,Cartesian3,Color,Ellipsoid,Entity,Globe,JulianDate,Matrix4,PointPrimitiveCollection,Scene,SingleTileImageryProvider} from 'cesium';
import {StableOrbitCollection} from '../src/services/stableOrbitCollection.js';
import {attachSatelliteOrbit,styleSatelliteOrbit,updateSatelliteOrbit} from '../src/services/orbitVisuals.js';
import {createSatelliteOrbitState,createSatelliteTrack} from '../src/services/satelliteOrbitState.js';
const canvas=document.querySelector('#scene'),status=document.querySelector('#status'),report=document.querySelector('#report');
const scene=new Scene({canvas,scene3DOnly:true,msaaSamples:4,contextOptions:{webgl:{antialias:true,preserveDrawingBuffer:true}}});
scene.backgroundColor=Color.fromCssColorString('#03080e');scene.globe=new Globe(Ellipsoid.WGS84);scene.globe.baseColor=Color.fromCssColorString('#193342');scene.globe.enableLighting=false;
scene.globe.imageryLayers.addImageryProvider(await SingleTileImageryProvider.fromUrl('/textures/planets/earth.jpg',{credit:'NASA/JPL/USGS reference Earth'}));
const precise=(await(await fetch('/tests/fixtures/satellite-cartesian.json')).json()).objects;
const dense=(await(await fetch('/tests/fixtures/satellite-load-sgp4.json')).json()).objects;
let group,dots,rows=[],time,playing=false,last=performance.now(),range=1,raf,disposed=false;
const names={39084:'Landsat 8 · polar / Sun-synchronous',25867:'Chandra · highly eccentric',58990:'INSAT-3DS · geostationary',26407:'GPS · navigation'};
function frame(){
 const states=rows.map(r=>r.data.orbitState),primary=states[0];
 const fit=BoundingSphere.fromPoints(document.querySelector('#case').value==='dense'?primary.positions:states.flatMap(s=>s.positions));
 const x=Cartesian3.normalize(primary.positions[0],new Cartesian3());
 const normal=Cartesian3.normalize(Cartesian3.cross(primary.positions[0],primary.positions[Math.floor(primary.positions.length/4)],new Cartesian3()),new Cartesian3());
 const up=Cartesian3.normalize(Cartesian3.cross(normal,x,new Cartesian3()),new Cartesian3());
 const eye=Cartesian3.add(fit.center,Cartesian3.add(Cartesian3.multiplyByScalar(normal,fit.radius*1.25/Math.tan(scene.camera.frustum.fovy/2)*range,new Cartesian3()),Cartesian3.multiplyByScalar(up,fit.radius*.45*range,new Cartesian3()),new Cartesian3()),new Cartesian3());
 const matrix=primary.matrix,target=Matrix4.multiplyByPoint(matrix,fit.center,new Cartesian3()),destination=Matrix4.multiplyByPoint(matrix,eye,new Cartesian3());
 scene.camera.setView({destination,orientation:{direction:Cartesian3.normalize(Cartesian3.subtract(target,destination,new Cartesian3()),new Cartesian3()),up:Matrix4.multiplyByPointAsVector(matrix,up,new Cartesian3())}});scene.camera.frustum.far=Math.max(fit.radius*30,1e8);
}
function choose(){
 if(group)scene.primitives.remove(group);if(dots)scene.primitives.remove(dots);
 group=scene.primitives.add(new StableOrbitCollection());dots=scene.primitives.add(new PointPrimitiveCollection());
 const key=document.querySelector('#case').value,ids={polar:39084,eccentric:25867,geo:58990,gps:26407};
 const source=key==='dense'?dense:precise.filter(r=>r.orbit.norad_id===ids[key]);
 rows=source.map((row,i)=>{const state=createSatelliteOrbitState(row.orbit),track=createSatelliteTrack(row.trajectory),color=Color.fromHsl((i*.17+.51)%1,.28,.67),data={trajectory:row.trajectory,track,orbitEntity:new Entity({polyline:{positions:state.positions}})};styleSatelliteOrbit(data,color,false,source.length,0);attachSatelliteOrbit(data,group,state.positions,state);return{data,color,row,marker:dots.add({position:Cartesian3.ZERO,pixelSize:4,color:new Color(.85,.92,1),outlineColor:Color.fromCssColorString('#182530'),outlineWidth:1})};});
 time=rows.flatMap(r=>[r.data.track.start,r.data.orbitState.start]).reduce((a,b)=>JulianDate.greaterThan(a,b)?a:b);time=JulianDate.addSeconds(time,35,new JulianDate());range=1;update();frame();
 status.textContent=key==='dense'?'44 real orbital paths':names[ids[key]];
}
function update(){
 const selected=document.querySelector('#selected').checked;
 for(const [i,r] of rows.entries()){styleSatelliteOrbit(r.data,r.color,selected&&i===0,rows.length,Math.max(0,scene.camera.positionCartographic.height));updateSatelliteOrbit(r.data,time);r.marker.position=r.data.track.fixedAt(time);r.marker.pixelSize=selected&&i===0?6:4;}
 report.textContent=JSON.stringify({time:JulianDate.toIso8601(time),count:rows.length,selected,paths:rows.map(r=>({id:r.row.orbit.norad_id,vertices:r.data.orbitLine.positions.length,revision:r.data.orbitLine.geometryRevision,current:r.data.orbitLine.material.uniforms.current,phase:r.data.orbitLine.material.uniforms.phase}))});
}
function render(now){if(disposed)return;const dt=Math.min(.1,(now-last)/1000);last=now;if(playing)JulianDate.addSeconds(time,dt,time);if(canvas.width!==canvas.clientWidth || canvas.height!==canvas.clientHeight){canvas.width=canvas.clientWidth;canvas.height=canvas.clientHeight;scene.camera.frustum.aspectRatio=canvas.width/canvas.height;}update();scene.initializeFrame();scene.render(time);raf=requestAnimationFrame(render);}
document.querySelector('#case').onchange=choose;document.querySelector('#selected').onchange=()=>update();document.querySelector('#reset').onclick=()=>{range=1;frame();};
document.querySelector('#near').onclick=()=>{range*=.7;frame();};document.querySelector('#far').onclick=()=>{range*=1.4;frame();};document.querySelector('#drag').onclick=()=>scene.camera.rotateLeft(.18);
document.querySelector('#step').onclick=()=>JulianDate.addSeconds(time,30,time);
document.querySelector('#refresh').onclick=()=>{for(const r of rows){r.data.track.merge(r.row.refresh);const next=createSatelliteOrbitState(r.row.orbit);attachSatelliteOrbit(r.data,group,next.positions,next);}status.textContent='Real overlap merged · resident owner retained';};
document.querySelector('#play').onclick=e=>{playing=!playing;e.target.textContent=playing?'Pause real time':'Play real time';};
function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);scene.destroy();status.textContent='Disposed · scene, orbit materials and geometry released';}
document.querySelector('#dispose').onclick=dispose;window.addEventListener('pagehide',dispose,{once:true});canvas.width=canvas.clientWidth;canvas.height=canvas.clientHeight;scene.camera.frustum.aspectRatio=canvas.width/canvas.height;choose();raf=requestAnimationFrame(render);
