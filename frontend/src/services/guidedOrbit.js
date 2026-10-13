import { Cartesian3, Matrix3, Matrix4 } from "cesium";

export const GUIDED_ECCENTRICITY_ENTER = .03;
export const GUIDED_ECCENTRICITY_EXIT = .025;
const TAU = Math.PI * 2;
// All circular guides share immutable unit geometry. Radius/plane updates are
// matrix changes, never per-frame vertices or independently animated motion.
const CIRCLE = Array.from({length:481},(_,i)=>new Cartesian3(Math.cos(TAU*i/480),Math.sin(TAU*i/480),0));
CIRCLE[480] = Cartesian3.clone(CIRCLE[0]);

export function fitGuidedOrbit(state, previous) {
  const radii=state.positions.map(p=>Cartesian3.magnitude(p));
  const minimum=Math.min(...radii), maximum=Math.max(...radii);
  const eccentricity=(maximum-minimum)/(maximum+minimum);
  const eccentric=eccentricity >= (previous?.eccentric ? GUIDED_ECCENTRICITY_EXIT : GUIDED_ECCENTRICITY_ENTER);
  const normal=new Cartesian3(), edge=new Cartesian3();
  for(let i=0;i<state.positions.length-1;i++) {
    const a=Cartesian3.normalize(state.positions[i],new Cartesian3());
    const b=Cartesian3.normalize(state.positions[i+1],new Cartesian3());
    Cartesian3.cross(a,b,edge);Cartesian3.add(normal,edge,normal);
  }
  if(Cartesian3.magnitude(normal)<1e-6) return {eccentric:true,eccentricity,reason:"Orbital plane unavailable"};
  Cartesian3.normalize(normal,normal);
  // Preserve the angular origin across refreshes, avoiding a texture-phase spin.
  let seed=previous?.x || state.positions[0];
  const x=Cartesian3.subtract(seed,Cartesian3.multiplyByScalar(normal,Cartesian3.dot(seed,normal),new Cartesian3()),new Cartesian3());
  if(Cartesian3.magnitude(x)<1e-6) {
    seed=Math.abs(normal.x)<.9 ? Cartesian3.UNIT_X : Cartesian3.UNIT_Y;
    Cartesian3.subtract(seed,Cartesian3.multiplyByScalar(normal,Cartesian3.dot(seed,normal),new Cartesian3()),x);
  }
  Cartesian3.normalize(x,x);
  const y=Cartesian3.normalize(Cartesian3.cross(normal,x,new Cartesian3()),new Cartesian3());
  const radius=radii.reduce((a,b)=>a+b,0)/radii.length;
  const basis=new Matrix3(x.x,x.y,x.z,y.x,y.y,y.z,normal.x,normal.y,normal.z);
  // Matrix3's constructor takes row-major values.
  Matrix3.transpose(basis,basis);
  return {eccentric,eccentricity,normal,x,y,radius,positions:CIRCLE,
    referenceX:Cartesian3.clone(x),transform:Matrix4.fromRotationTranslation(basis,Cartesian3.ZERO),matrix:new Matrix4()};
}

export function guidedOrbitPhase(guide, point) {
  const phase=Math.atan2(Cartesian3.dot(point,guide.y),Cartesian3.dot(point,guide.x))/TAU;
  return (phase+1)%1;
}

const tangentA=new Cartesian3(),tangentB=new Cartesian3(),tangent=new Cartesian3(),projection=new Cartesian3(),frameBasis=new Matrix3();
export function updateGuidedFrame(guide, earthFrame, point, state) {
  let radius=guide.radius;
  if(point && state) {
    const last=state.positions.length-1, index=state.phase*last, i=Math.min(last-1,Math.floor(index));
    // Interpolated wide central chords suppress rounded-coordinate noise. This
    // is derived from actual sampled motion, not a cosmetic orientation timer.
    const derivative=(j,result)=>Cartesian3.subtract(state.positions[Math.min(last,j+2)],state.positions[Math.max(0,j-2)],result);
    derivative(i,tangentA);derivative(i+1,tangentB);
    Cartesian3.lerp(tangentA,tangentB,index-i,tangent);
    Cartesian3.cross(point,tangent,guide.normal);
    if(Cartesian3.magnitude(guide.normal)>1e-6) {
      Cartesian3.normalize(guide.normal,guide.normal);
      Cartesian3.multiplyByScalar(guide.normal,Cartesian3.dot(guide.referenceX,guide.normal),projection);
      Cartesian3.subtract(guide.referenceX,projection,guide.x);
      if(Cartesian3.magnitude(guide.x)<1e-6) Cartesian3.clone(point,guide.x);
      Cartesian3.normalize(guide.x,guide.x);
      Cartesian3.normalize(Cartesian3.cross(guide.normal,guide.x,guide.y),guide.y);
      Matrix3.setColumn(frameBasis,0,guide.x,frameBasis);Matrix3.setColumn(frameBasis,1,guide.y,frameBasis);Matrix3.setColumn(frameBasis,2,guide.normal,frameBasis);
      Matrix4.fromRotationTranslation(frameBasis,Cartesian3.ZERO,guide.transform);
    }
    // A near-circular guide adapts to actual radius at scene time, so the peak
    // meets the real marker even for navigation satellites. Still schematic.
    radius=Cartesian3.magnitude(point);
  }
  Matrix4.multiply(earthFrame,guide.transform,guide.matrix);
  Matrix4.multiplyByUniformScale(guide.matrix,radius,guide.matrix);
}

export function orbitStyleDisclosure(style, guide) {
  if(style === "scientific") return "Scientific Orbit · real SGP4-sampled path";
  if(!guide) return "Guided Orbit · schematic circular guide; marker remains SGP4";
  return guide.eccentric ? "Guided Orbit · real SGP4 path automatically used for eccentric orbit" : "Guided Orbit · schematic circular guide; marker remains SGP4";
}
