import { ArcType, Cartesian3, Color, Entity, JulianDate, Material, Matrix3, Matrix4, PolylineCollection, Scene } from "cesium";
import { CELESTIAL_BODIES } from "../src/data/celestialBodies.js";
import { bodyPositionFixed, inertialToFixedMatrix, sampleBodyOrbitFixed } from "../src/data/solarSystemEphemeris.js";
import { createOrbitStroke } from "../src/services/orbitStroke.js";
import { StableOrbitCollection } from "../src/services/stableOrbitCollection.js";
import { attachSatelliteOrbit, setSatelliteOrbitDisplay, styleSatelliteOrbit, updateSatelliteOrbit } from "../src/services/orbitVisuals.js";
import { createSatelliteOrbitMaterial } from "../src/services/satelliteOrbitMaterial.js";
import { createSatelliteOrbitState, createSatelliteTrack, satelliteFrame } from "../src/services/satelliteOrbitState.js";

const canvas = document.querySelector("canvas"), status = document.querySelector("output"), results = document.querySelector("pre");
const scene = new Scene({ canvas, scene3DOnly:true, msaaSamples:1, contextOptions:{ webgl:{ antialias:false, preserveDrawingBuffer:true } } });
scene.backgroundColor = Color.BLACK;
const gl = canvas.getContext("webgl2");
const pixels = new Uint8Array(canvas.width*canvas.height*4);
const bufferData = gl.bufferData.bind(gl);
let uploads = 0;
gl.bufferData = (...args) => { uploads++; return bufferData(...args); };
const oldShader = `czm_material czm_getMaterial(czm_materialInput d) {
  czm_material m=czm_getDefaultMaterial(d);
  float edge=abs(d.st.t-.5)*2.; float aa=max(fwidth(edge),.08);
  float core=clamp(glowPower,.3,.65);
  float c=1.-smoothstep(core-aa,core+aa,edge);
  float halo=.06*(1.-smoothstep(core,1.,edge));
  m.diffuse=color.rgb; m.alpha=color.a*clamp(c+halo,0.,1.); return m;
}`;

async function measure(id, legacy, moving, close = false) {
  const time = JulianDate.fromIso8601("2026-10-06T00:00:00Z");
  const center = CELESTIAL_BODIES[id].type === "Moon" ? CELESTIAL_BODIES[id].parent : "sun";
  const origin = bodyPositionFixed(center,time), inverse = Matrix3.transpose(inertialToFixedMatrix(time),new Matrix3());
  const path = sampleBodyOrbitFixed(id,time,96).map(p=>Matrix3.multiplyByVector(inverse,Cartesian3.subtract(p,origin,p),p));
  const size = Math.max(...path.map(p=>Cartesian3.magnitude(p)));
  const group = scene.primitives.add(legacy ? new PolylineCollection() : new StableOrbitCollection());
  const material = legacy ? new Material({ fabric:{ type:"OrbitWatchLegacyStrokeProbe", uniforms:{
    color:{type:"vec4",x:.7,y:.85,z:1,w:.4},glowPower:.45 },source:oldShader },translucent:true }) : createOrbitStroke(new Color(.7,.85,1,.4));
  group.add({ positions:path, width:2.5, material, arcType:ArcType.NONE });
  const energy = [], changes = [], centreEnergy = [];
  let prior;
  uploads=0;
  for (let frame=0; frame<90; frame++) {
    const t = JulianDate.addSeconds(time,frame*.37,new JulianDate());
    const rotation = inertialToFixedMatrix(t), centre = bodyPositionFixed(center,t);
    Matrix4.fromRotationTranslation(rotation,centre,group.modelMatrix);
    const target = close ? path[0] : Cartesian3.ZERO;
    const eyeLocal = close ? Cartesian3.add(target,new Cartesian3(0,-size*.0005,size*.0005),new Cartesian3()) : new Cartesian3(0,-size*2.4,size*1.6);
    // Small continuous camera gestures exercise subpixel edge crossings.
    if (moving) eyeLocal.x += size*Math.sin(frame*.035)*(close?.00000001:.003);
    const destination = Cartesian3.add(Matrix3.multiplyByVector(rotation,eyeLocal,new Cartesian3()),centre,new Cartesian3());
    const direction = Matrix3.multiplyByVector(rotation,Cartesian3.normalize(Cartesian3.subtract(target,eyeLocal,new Cartesian3()),new Cartesian3()),new Cartesian3());
    const up = Matrix3.multiplyByVector(rotation,Cartesian3.UNIT_Z,new Cartesian3());
    scene.camera.setView({ destination, orientation:{ direction,up } });
    scene.camera.frustum.far = size*10;
    scene.initializeFrame(); scene.render(t);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let sum=0, diff=0, centreSum=0;
    for(let p=0;p<pixels.length;p+=4) { const rgb=pixels[p]+pixels[p+1]+pixels[p+2]; sum+=rgb; const x=(p/4)%canvas.width,y=Math.floor(p/4/canvas.width); if(Math.abs(x-canvas.width/2)<8 && Math.abs(y-canvas.height/2)<8) centreSum+=rgb; if(prior) diff+=Math.abs(pixels[p]-prior[p])+Math.abs(pixels[p+1]-prior[p+1])+Math.abs(pixels[p+2]-prior[p+2]); }
    if(frame>5) { energy.push(sum); centreEnergy.push(centreSum); if(prior) changes.push(diff/Math.max(1,sum)); }
    prior=pixels.slice();
    await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  const mean=energy.reduce((a,b)=>a+b,0)/energy.length;
  const spread=(Math.max(...energy)-Math.min(...energy))/Math.max(1,mean);
  const centreMean=centreEnergy.reduce((a,b)=>a+b,0)/centreEnergy.length;
  const report={id,renderer:legacy?"legacy":"resident",view:close?"close":"overview",camera:moving?"moving":"fixed",meanEnergy:Math.round(mean),energySpread:Number(spread.toFixed(6)),maxFrameChange:Number(Math.max(...changes).toFixed(6)),centreMin:Math.min(...centreEnergy),centreMax:Math.max(...centreEnergy),centreSpread:Number(((Math.max(...centreEnergy)-Math.min(...centreEnergy))/Math.max(1,centreMean)).toFixed(6)),bufferUploads:uploads};
  scene.primitives.remove(group);
  return report;
}
async function run(close) {
  document.querySelectorAll("button").forEach(button=>button.disabled=true);
  const reports=[];
  try {
    for (const id of ["earth","mars","phobos","jupiter","saturn","neptune","eris"]) for(const moving of [false,true]) for(const legacy of [true,false]) {
      status.textContent=`${id} / ${moving?"moving":"fixed"} / ${legacy?"legacy":"resident"}`;
      reports.push(await measure(id,legacy,moving,close)); results.textContent=JSON.stringify(reports,null,2);
    }
    status.textContent="Complete";
  } catch(error) { status.textContent=`FAILED: ${error.message}`; console.error(error); }
  finally { document.querySelectorAll("button").forEach(button=>button.disabled=false); }
}
document.querySelector("#run").addEventListener("click",()=>run(false));
document.querySelector("#close").addEventListener("click",()=>run(true));
// Node material construction does not compile GLSL. Exercise the actual Cesium
// WebGL2 program (including picking/log depth), full-period phase, camera/zoom
// changes and same-material geometry replacement using recorded real SGP4 paths.
document.querySelector("#satellite").addEventListener("click",async()=>{
  document.querySelectorAll("button").forEach(button=>button.disabled=true);
  const reports=[];
  try {
    const recorded=await (await fetch("/tests/fixtures/satellite-sgp4.json")).json();
    for(const {orbit} of recorded.objects) {
      status.textContent=`Satellite ${orbit.norad_id}`;
      const state=createSatelliteOrbitState(orbit);
      const group=scene.primitives.add(new StableOrbitCollection());
      try {
        const material=createSatelliteOrbitMaterial(new Color(.6,.85,1,.72));
        const line=group.add({positions:state.positions,material,pickable:true,modelMatrix:state.matrix});
        const energy=[]; uploads=0;
        for(let frame=0;frame<90;frame++) {
          const time=JulianDate.addSeconds(state.start,state.duration*frame/89,new JulianDate());
          satelliteFrame(time,state.matrix);
          material.uniforms.phase=frame/89%1;
          material.uniforms.baseAlpha=frame<45?.2:.075;
          // A successful refresh creates a new real sampled buffer, retaining
          // the shader/opacity. It must not produce an empty rendered frame.
          if(frame===45) line.positions=state.positions.map(p=>Cartesian3.clone(p));
          const angle=.18*Math.sin(frame*.06), range=state.radius*(2.4+.2*Math.sin(frame*.04));
          const eye=Matrix4.multiplyByPoint(state.matrix,new Cartesian3(range*angle,-range,range*.6),new Cartesian3());
          scene.camera.setView({destination:eye,orientation:{direction:Cartesian3.normalize(Cartesian3.negate(eye,new Cartesian3()),new Cartesian3()),up:Cartesian3.UNIT_Z}});
          scene.camera.frustum.far=state.radius*12;
          scene.initializeFrame(); scene.render(time);
          gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          let sum=0;
          for(let p=0;p<pixels.length;p+=4) sum+=pixels[p]+pixels[p+1]+pixels[p+2];
          energy.push(sum);
          await new Promise(resolve=>requestAnimationFrame(resolve));
        }
        const report={noradId:orbit.norad_id,frames:energy.length,emptyFrames:energy.filter(e=>e===0).length,minEnergy:Math.min(...energy),geometryRevisions:line.geometryRevision,bufferUploads:uploads,phase:material.uniforms.phase};
        if(report.emptyFrames || report.geometryRevisions!==2) throw new Error(`Satellite GPU regression failed: ${JSON.stringify(report)}`);
        reports.push(report);results.textContent=JSON.stringify(reports,null,2);
      } finally { scene.primitives.remove(group); }
    }
    status.textContent="Satellite shader regression passed";
  } catch(error) { status.textContent=`FAILED: ${error.message}`;console.error(error); }
  finally {document.querySelectorAll("button").forEach(button=>button.disabled=false);}
});
window.addEventListener("pagehide",()=>{ scene.destroy(); });

// Concurrent native GPU coverage using real, recorded read-only backend data.
// No synthetic paths, production API bypass or account/database writes.
document.querySelector("#load").addEventListener("click",async()=>{
  document.querySelectorAll("button").forEach(button=>button.disabled=true);
  const reports=[];
  try {
    const recorded=await (await fetch("/tests/fixtures/satellite-load-sgp4.json")).json();
    for(const count of [1,6,12,24,44]) for(const style of ["guided","scientific"]) {
      const group=scene.primitives.add(new StableOrbitCollection());
      const tracks=recorded.objects.slice(0,count).map(({orbit,trajectory,refresh},index)=>{
        const state=createSatelliteOrbitState(orbit), track=createSatelliteTrack(trajectory);
        const data={trajectory,track,orbitEntity:new Entity({polyline:{positions:state.positions}})};
        styleSatelliteOrbit(data,new Color(.6,.85,1),index===0,count);
        attachSatelliteOrbit(data,group,state.positions,state);
        setSatelliteOrbitDisplay(data,style);
        const line=data.orbitLine;
        return {data,state,track,refresh,line,position:track.position,noradId:orbit.norad_id,maxDistance:0};
      });
      // Orbit requests were recorded after the first trajectory batch. Begin
      // inside their shared interval; do not wrap a pre-orbit timestamp into
      // the end of the next period (SGP4 precession makes that a different path).
      const start=tracks.flatMap(({state,track})=>[state.start,track.start]).reduce((latest,time)=>JulianDate.greaterThan(time,latest)?time:latest);
      const radius=Math.max(...tracks.map(({state})=>state.radius));
      let emptyFrames=0, maxDistance=0, unavailablePositions=0, emptyRefreshFrames=0;
      uploads=0;
      try {
        for(let frame=0;frame<90;frame++) {
          status.textContent=`${count} satellites / ${style} / frame ${frame+1}/90`;
          const time=JulianDate.addSeconds(start,frame*2.5,new JulianDate());
          for(const row of tracks) {
            const {data,state,track,refresh,line,position}=row;
            if(frame===45) {
              track.merge(refresh);
              if(track.position!==position) throw new Error("Refresh replaced position property");
              if(style === "scientific" || data.orbitGuide.eccentric) line.positions=state.positions.map(p=>Cartesian3.clone(p));
            }
            satelliteFrame(time,state.matrix);
            const point=track.inertialAt(time);
            if(!point || track.isStale(time)) unavailablePositions++;
            updateSatelliteOrbit(data,time);
            maxDistance=Math.max(maxDistance,state.distance);
            row.maxDistance=Math.max(row.maxDistance,state.distance);
          }
          const angle=.35*Math.sin(frame*.04), range=radius*(2.4+.5*Math.sin(frame*.03));
          const eye=new Cartesian3(range*angle,-range,range*.65);
          scene.camera.setView({destination:eye,orientation:{direction:Cartesian3.normalize(Cartesian3.negate(eye,new Cartesian3()),new Cartesian3()),up:Cartesian3.UNIT_Z}});
          scene.camera.frustum.far=radius*12;
          scene.initializeFrame();scene.render(time);
          gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          let sum=0;for(let p=0;p<pixels.length;p+=4) sum+=pixels[p]+pixels[p+1]+pixels[p+2];
          if(!sum) { emptyFrames++;if(frame>=44 && frame<=46) emptyRefreshFrames++; }
          if(group.length!==count || tracks.some(({line})=>!line.primitive.ready)) throw new Error("Missing resident path");
          await new Promise(resolve=>requestAnimationFrame(resolve));
        }
        const report={count,style,frames:90,emptyFrames,emptyRefreshFrames,unavailablePositions,maxPhaseDistanceMeters:maxDistance,bufferUploads:uploads,
          geometryRevisions:tracks.map(({line})=>line.geometryRevision),phaseDistances:tracks.map(({noradId,maxDistance})=>({noradId,maxDistance})),selectedAlpha:tracks[0].line.material.uniforms.color.w,contextAlpha:tracks[1]?.line.material.uniforms.color.w ?? null};
        if(emptyFrames || unavailablePositions || maxDistance>10000 || tracks.some(({line,data})=>line.geometryRevision!==(style==="guided" && !data.orbitGuide.eccentric ? 1 : 2))) throw new Error(`Concurrent regression failed: ${JSON.stringify(report)}`);
        reports.push(report);results.textContent=JSON.stringify(reports,null,2);
      } finally {
        scene.primitives.remove(group);
      }
      if(!group.isDestroyed() || group.length!==0) throw new Error("Resident path cleanup failed");
    }
    status.textContent="1/6/12/24/44 Guided/Scientific real satellite GPU regression passed";
  } catch(error) { status.textContent=`FAILED: ${error.message}`;console.error(error); }
  finally {document.querySelectorAll("button").forEach(button=>button.disabled=false);}
});
