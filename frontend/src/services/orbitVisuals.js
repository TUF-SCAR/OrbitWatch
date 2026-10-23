import { Cartesian3, Color } from "cesium";
import { createOrbitStroke, OrbitStrokeMaterialProperty } from "./orbitStroke.js";
import { createSatelliteOrbitMaterial } from "./satelliteOrbitMaterial.js";
import { satelliteFrame, satelliteOrbitPhase, satelliteOrbitRefreshDue } from "./satelliteOrbitState.js";
import { prefersReducedMotion } from "../utils/motionPreferences.js";

const smooth = value => {const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
export const TRACE_REVEAL_MS = 650;
// Readability follows angular extent, not a fixed Earth altitude cutoff. A
// high-apogee path remains legible at its own scale. No position is rescaled.
export function satelliteOrbitStyle(selected, count, height = 27000000, radius = 7000000) {
  radius=Math.max(1,radius || 7000000);
  const angular=radius/Math.max(radius,height+6378137);
  const contextLod=smooth((angular-.002)/.010), selectedLod=smooth((angular-.0005)/.0035);
  const crowd=Math.min(1,Math.sqrt(6/Math.max(1,count)));
  const base=(.14+.14*crowd)*contextLod,selectedAlpha=.94*selectedLod;
  const selectedWidth=1.35+.15*(1-smooth((angular-.02)/.1));
  return {width:selected?selectedWidth:.8,selectedWidth,alpha:selected?selectedAlpha:base,base,selectedAlpha};
}

export function styleSatelliteOrbit(data, color, selected, count, height, {now=performance.now(),reduced=prefersReducedMotion()}={}) {
  const line=data.orbitEntity?.polyline;
  if(!line) return;
  if(!data.orbitVisual || data.orbitVisual.line!==line) {
    const tint=Color.clone(color),material=new OrbitStrokeMaterialProperty({color:tint});
    data.orbitVisual={line,tint,material,selected:false,weight:0,reveal:1,changedAt:now,from:0};
    line.material=material;
  }
  const visual=data.orbitVisual;
  if(selected!==visual.selected) {
    visual.selected=selected;visual.from=visual.weight;visual.changedAt=now;
    if(selected) {visual.reveal=0;visual.pendingAnchor=true;}
  }
  const elapsed=Math.max(0,now-visual.changedAt);
  visual.weight=visual.from+((selected?1:0)-visual.from)*(reduced?1:smooth(elapsed/(selected?130:220)));
  if(selected) visual.reveal=reduced?1:smooth(elapsed/TRACE_REVEAL_MS);
  const style=satelliteOrbitStyle(selected,count,height,data.orbitState?.radius);
  visual.tint.alpha=style.alpha;visual.material.color.setValue(visual.tint);line.width=style.width;
  if(data.orbitLine) {
    const gpu=data.orbitLine,u=gpu.material.uniforms;
    // One padded raster quad: a fine core plus a narrow dark contrast edge.
    // Both are integrated in the same fragment; no duplicate translucent paths.
    gpu.strokePixels=style.selectedWidth;gpu.width=style.width;
    gpu.show=data.orbitEntity.show && (style.base>0 || visual.weight*style.selectedAlpha>0);
    u.color.x=.48*.8+color.red*.2;u.color.y=.56*.8+color.green*.2;u.color.z=.64*.8+color.blue*.2;u.color.w=style.alpha;
    u.baseAlpha=style.base;u.selectedAlpha=style.selectedAlpha;
    u.selection=visual.weight;u.reveal=visual.reveal;
  }
}

export function attachSatelliteOrbit(data, collection, positions, state) {
  data.orbitEntity.polyline.show=false;
  if(data.orbitLine) data.orbitLine.positions=positions;
  else data.orbitLine=collection.add({id:data.orbitEntity,positions,
    material:state?createSatelliteOrbitMaterial(data.orbitVisual.tint):createOrbitStroke(data.orbitVisual.tint),show:data.orbitEntity.show,pickable:true});
  if(state) {
    state.positions ||= positions;data.orbitState=state;data.orbitLine.modelMatrix=state.matrix;
    data.orbitLine.orbitwatchSatellite={state,track:data.track};
    data.orbitEpoch=state.epoch ?? data.trajectory?.tle_epoch;
    // Reproject the selection origin if a real path refresh lands mid-reveal.
    // Preserve its elapsed transition; never restart the selection on refresh.
    const visual=data.orbitVisual;
    if(visual?.anchorPoint) data.orbitLine.material.uniforms.revealOrigin=satelliteOrbitPhase(state,visual.anchorPoint,visual.anchorTime);
  }
}
export function satelliteOrbitNeedsRefresh(data) {return !data.orbitLine || satelliteOrbitRefreshDue(data);}
export function removeSatelliteOrbit(data,collection) {
  if(data.orbitLine) collection?.remove(data.orbitLine);
  data.orbitLine=null;data.orbitVisual=null;data.orbitState=null;
}
const satellitePoint=new Cartesian3();
export function updateSatelliteOrbit(data,time) {
  const state=data.orbitState,track=data.track;
  if(!state || !track || !data.orbitLine) return;
  const effective=track.effectiveTime(time);
  if(track.frameAt) track.frameAt(effective,state.matrix);else satelliteFrame(effective,state.matrix);
  const uniforms=data.orbitLine.material.uniforms;
  uniforms.phase=satelliteOrbitPhase(state,track.inertialAt(effective,satellitePoint),effective);
  const visual=data.orbitVisual;
  if(visual?.pendingAnchor) {
    visual.pendingAnchor=false;visual.anchorPoint=Cartesian3.clone(satellitePoint);visual.anchorTime=effective.clone();
    uniforms.revealOrigin=uniforms.phase;
  }
  state.needsRefresh=state.distance>Math.max(1500,state.radius*.00015);
  state.stale=data.orbitEpoch!==data.trajectory?.tle_epoch;
  uniforms.current=track.isStale(time)||state.stale?0:1;
}

export function solarOrbitStyle({ moon, selected, local, solar, overview }) {
  if (moon) return { width: selected ? 2.8 : 2.5, alpha: (selected ? 0.2 : local * 0.12) * (1 - solar) };
  return { width: selected ? 2.8 : 2.5,
    alpha: selected ? solar * (0.24 - overview * 0.08) : Math.max(0, (overview - 0.25) / 0.75) * 0.085 };
}
