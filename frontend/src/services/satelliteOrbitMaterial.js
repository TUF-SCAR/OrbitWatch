import { Material } from "cesium";

// One padded quad draws the quiet complete path and its active temporal region.
// No coincident base/highlight primitives, per-frame vertices or dashed pattern.
export const SATELLITE_ORBIT_SOURCE = `
czm_material czm_getMaterial(czm_materialInput inputData) {
  czm_material result = czm_getDefaultMaterial(inputData);
  float t = inputData.st.t;
  float footprint = max(fwidth(t), 0.0001);
  float halfCore = clamp(glowPower, 0.05, 0.8) * 0.5;
  float overlap = max(0.0, min(t + footprint*0.5, 0.5 + halfCore)
    - max(t - footprint*0.5, 0.5 - halfCore));
  float coverage = clamp(overlap / footprint, 0.0, 1.0);
  float d = fract(inputData.st.s - phase + 0.5) - 0.5;
  float width = d >= 0.0 ? 0.065 : 0.17;
  float tail = d >= 0.0 ? 1.0 : 0.3 + 0.7 * exp(-pow(d / 0.035, 2.0));
  float taper = 1.0 - smoothstep(0.35, 0.5, abs(d));
  float phaseWeight = exp(-0.5 * pow(d / width, 2.0)) * tail * taper;
  result.diffuse = color.rgb;
  result.alpha = coverage * (baseAlpha + (color.a - baseAlpha) * phaseWeight * current);
  return result;
}`;

export function createSatelliteOrbitMaterial(color) {
  return new Material({ fabric: { type: "OrbitWatchSatellitePhaseV1", source: SATELLITE_ORBIT_SOURCE,
    uniforms: { color: { type:"vec4", x:color.red, y:color.green, z:color.blue, w:color.alpha },
      glowPower:.45, baseAlpha:.08, phase:0, current:1 } }, translucent:true });
}
