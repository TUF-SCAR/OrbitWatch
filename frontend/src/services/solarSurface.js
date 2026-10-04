import { CustomShader, LightingModel } from "cesium";

// Illustrative photosphere: spatial grain and limb darkening, not solar imagery.
// Fixed object-space detail avoids per-frame texture uploads and temporal shimmer.
export function createSolarSurface() {
  return new CustomShader({
    lightingModel: LightingModel.UNLIT,
    fragmentShaderText: `
      float solarHash(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float solarNoise(vec3 p) {
        vec3 cell = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(solarHash(cell), solarHash(cell + vec3(1,0,0)), f.x),
                       mix(solarHash(cell + vec3(0,1,0)), solarHash(cell + vec3(1,1,0)), f.x), f.y),
                   mix(mix(solarHash(cell + vec3(0,0,1)), solarHash(cell + vec3(1,0,1)), f.x),
                       mix(solarHash(cell + vec3(0,1,1)), solarHash(cell + vec3(1,1,1)), f.x), f.y), f.z);
      }
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec3 p = normalize(fsInput.attributes.positionMC);
        float coarse = solarNoise(p * 18.0);
        // Fade sub-pixel grain at distant views rather than aliasing it.
        float footprint = max(length(dFdx(p)), length(dFdy(p)));
        float grain = mix(0.5, solarNoise(p * 170.0), 1.0 - smoothstep(0.003, 0.018, footprint));
        float mu = max(0.0, dot(normalize(fsInput.attributes.normalEC), -normalize(fsInput.attributes.positionEC)));
        float limb = 0.35 + 0.65 * pow(mu, 0.55);
        float brightness = (0.72 + 0.2 * coarse + 0.16 * grain) * limb;
        material.diffuse = mix(vec3(0.86, 0.22, 0.025), vec3(1.0, 0.72, 0.25), brightness);
        material.emissive = vec3(0.0);
        material.alpha = 1.0;
      }
    `,
  });
}
