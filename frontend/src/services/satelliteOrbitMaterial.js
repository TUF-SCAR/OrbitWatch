import { Material } from "cesium";

// Orbit Trace: a continuous silver filament, revealed once from the actual
// satellite on selection. No bloom, repeating chase or second depth surface.
export const SATELLITE_ORBIT_SOURCE = `
czm_material czm_getMaterial(czm_materialInput inputData) {
  czm_material result = czm_getDefaultMaterial(inputData);
  float t = inputData.st.t;
  float footprint = max(fwidth(t), 0.0001);
  float distanceFromOrigin = abs(fract(inputData.st.s - revealOrigin + 0.5) - 0.5);
  float illuminated = reveal >= 0.999 ? 1.0 : 1.0-smoothstep(reveal*0.54-0.035, reveal*0.54+0.035, distanceFromOrigin);
  float ink = selection * illuminated;
  float halfCore = mix(0.8/4.5, glowPower, ink)*0.5;
  float halfEdge = halfCore + mix(0.25,0.45,ink)/4.5;
  float core = clamp((min(t+footprint*0.5,0.5+halfCore)-max(t-footprint*0.5,0.5-halfCore))/footprint,0.0,1.0);
  float outer = clamp((min(t+footprint*0.5,0.5+halfEdge)-max(t-footprint*0.5,0.5-halfEdge))/footprint,0.0,1.0);
  // Only a small local sheen follows real phase. The complete path dominates.
  float d = fract(inputData.st.s-phase+0.5)-0.5;
  float sheen = exp(-0.5*pow(d/0.018,2.0))*current;
  vec3 silver = mix(vec3(0.91,0.94,0.98),vec3(1.0),0.35*sheen);
  vec3 inkColor = mix(color.rgb,silver,ink);
  float inkAlpha = mix(baseAlpha,selectedAlpha,ink)*core;
  float edgeAlpha = max(outer-core,0.0)*mix(baseAlpha*0.35,0.40,ink);
  float alpha = inkAlpha+edgeAlpha;
  result.diffuse = (inkColor*inkAlpha+vec3(0.025,0.045,0.065)*edgeAlpha)/max(alpha,0.00001);
  result.alpha = alpha;
  return result;
}`;
export function createSatelliteOrbitMaterial(color) {
  return new Material({fabric:{type:"OrbitWatchTraceV1",source:SATELLITE_ORBIT_SOURCE,
    uniforms:{color:{type:"vec4",x:color.red,y:color.green,z:color.blue,w:color.alpha},
      glowPower:1.35/4.5,baseAlpha:.28,selectedAlpha:.94,selection:0,reveal:1,revealOrigin:0,phase:0,current:1}},translucent:true});
}
