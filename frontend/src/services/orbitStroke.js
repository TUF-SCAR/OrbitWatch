import { Color, Material, PolylineGlowMaterialProperty } from "cesium";

const TYPE = "OrbitWatchOrbitStrokeV1";
// Integrate the thin stroke over the pixel footprint. Differentiate the linear
// coordinate, not abs(t-.5): the latter's derivative collapses/changes at the
// centre and makes subpixel paths pulse as the camera or reference frame moves.
export const ORBIT_STROKE_SOURCE = `
czm_material czm_getMaterial(czm_materialInput inputData) {
  czm_material result = czm_getDefaultMaterial(inputData);
  float t = inputData.st.t;
  float footprint = max(fwidth(t), 0.0001);
  float halfCore = clamp(glowPower, 0.05, 0.8) * 0.5;
  float overlap = max(0.0, min(t + footprint*0.5, 0.5 + halfCore)
    - max(t - footprint*0.5, 0.5 - halfCore));
  float coverage = clamp(overlap / footprint, 0.0, 1.0);
  result.diffuse = color.rgb;
  result.alpha = color.a * coverage;
  return result;
}`;

export function createOrbitStroke(color = Color.WHITE) {
  return new Material({ fabric: { type: TYPE, uniforms: {
    color: { type: "vec4", x: color.red, y: color.green, z: color.blue, w: color.alpha },
    glowPower: 0.45, taperPower: 1,
  }, source: ORBIT_STROKE_SOURCE }, translucent: true });
}

// Reuse Cesium's public Property implementation/events, but use our bounded
// Fabric shader. Registration uses Material's public constructor, once only.
let registered = false;
export class OrbitStrokeMaterialProperty extends PolylineGlowMaterialProperty {
  constructor(options = {}) {
    if (!registered) { createOrbitStroke().destroy(); registered = true; }
    super({ glowPower: 0.45, taperPower: 1, ...options });
  }
  getType() { return TYPE; }
}
