import { Appearance, BoundingSphere, Cartesian3, ComponentDatatype, CustomShader, Geometry, GeometryAttribute, GeometryInstance, Material, Matrix4, Primitive, PrimitiveType } from "cesium";
import { CELESTIAL_BODIES } from "../data/celestialBodies.js";
import { PLANETARY_RINGS, generatePlanetaryRings } from "../data/planetaryRings.js";
import { populationQuality } from "../data/proceduralPopulations.js";
import { bodyPositionFixed } from "../data/solarSystemEphemeris.js";
import { distanceFade } from "./solarSystemLod.js";

const VERTEX = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec4 ringColor;
in vec2 ringLimits;
in float batchId;
out vec2 v_ringPosition;
out vec2 v_ringLimits;
out vec4 v_ringColor;
void main() {
  vec4 p = czm_computePosition();
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
  v_ringPosition = position3DHigh.xy + position3DLow.xy;
  v_ringLimits = ringLimits; v_ringColor = ringColor;
}`;

export const RING_SOURCE = `
in vec2 v_ringPosition;
in vec2 v_ringLimits;
in vec4 v_ringColor;
float ringHash(ivec2 cell) {
  uvec2 p = uvec2(cell);
  uint h = p.x * 1664525u + p.y * 1013904223u + uint(seed) * 374761393u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return float(h ^ (h >> 16u)) / 4294967295.0;
}
czm_material czm_getMaterial(czm_materialInput inputData) {
  czm_material result = czm_getDefaultMaterial(inputData);
  float radius = length(v_ringPosition);
  float footprint = max(fwidth(radius), 0.000001);
  float width = v_ringLimits.y - v_ringLimits.x;
  float centre = (v_ringLimits.x + v_ringLimits.y) * 0.5;
  float edge = abs(radius - centre);
  float radial = (1.0 - smoothstep(width*0.5-footprint, width*0.5+footprint, edge)) * min(1.0, width/footprint);
  vec2 cell = v_ringPosition * 180.0;
  float pixelCell = max(length(dFdx(cell)), length(dFdy(cell)));
  float detail = 1.0 - smoothstep(0.35, 1.25, pixelCell);
  float grain = ringHash(ivec2(floor(cell)));
  vec2 within = fract(cell)-0.5;
  float aaCell = max(pixelCell*0.65,0.01);
  float hole = (1.0-smoothstep(0.43-aaCell,0.48+aaCell,length(within))) * (1.0-step(0.23,grain));
  // Fixed object-space debris with 85% occupancy. Unresolved grains integrate
  // to their mean, so zooming cannot turn them into temporal sparkle.
  float occupancy = mix(0.85, 1.0-hole, detail);
  float cellEnvelope = 1.0-smoothstep(0.35,0.5,max(abs(within.x),abs(within.y)));
  float structure = 0.93 + detail*0.14*(grain-0.5)*cellEnvelope;
  float radialDetail = 1.0 - smoothstep(0.25, 1.0, footprint*75.0);
  float striation = mix(0.92, 0.88 + 0.12*cos(radius*470.0+seed), radialDetail);
  float broadDetail = 1.0 - smoothstep(0.35, 1.25, footprint*18.0);
  striation *= mix(0.91, 0.87 + 0.09*cos(radius*63.0+seed) + 0.04*sin(radius*129.0-seed), broadDetail);
  // A simple planet shadow; illumination is illustrative rather than photometry.
  vec3 p = vec3(v_ringPosition, 0.0);
  float along = dot(p, sunDirection);
  float closest = length(p - sunDirection*min(along, 0.0));
  float shadow = along < 0.0 ? smoothstep(0.94, 1.04, closest) : 1.0;
  result.diffuse = v_ringColor.rgb * structure * striation * mix(0.28,1.0,shadow);
  result.alpha = alpha * v_ringColor.a * radial * occupancy;
  return result;
}`;
const FRAGMENT = `
void main() {
  czm_materialInput inputData;
  inputData.st = v_ringPosition;
  czm_material value = czm_getMaterial(inputData);
  if (value.alpha < 0.0001) discard;
  out_FragColor = vec4(value.diffuse, value.alpha);
}`;

export function ringVisibility(distance, radius, pixels = 720, fovy = Math.PI/3) {
  const diameter = pixels*radius/(Math.max(radius,distance)*Math.tan(fovy/2));
  return (1-distanceFade(distance/radius,22,48))*distanceFade(diameter,3,10);
}

export function ringPrimitive(data) {
  const geometry = new Geometry({ attributes: {
    position:new GeometryAttribute({ componentDatatype:ComponentDatatype.DOUBLE, componentsPerAttribute:3, values:data.positions }),
    ringColor:new GeometryAttribute({ componentDatatype:ComponentDatatype.FLOAT, componentsPerAttribute:4, values:data.colors }),
    ringLimits:new GeometryAttribute({ componentDatatype:ComponentDatatype.FLOAT, componentsPerAttribute:2, values:data.limits }),
  }, indices:data.indices, primitiveType:PrimitiveType.TRIANGLES, boundingSphere:BoundingSphere.fromVertices(data.positions) });
  const material = new Material({ fabric:{ type:"OrbitWatchPlanetaryRingsV1", uniforms:{ alpha:0, seed:data.seed, sunDirection:{ type:"vec3",x:0,y:0,z:1 } }, source:RING_SOURCE }, translucent:true });
  const primitive = new Primitive({ geometryInstances:new GeometryInstance({ geometry }),
    appearance:new Appearance({ material, vertexShaderSource:VERTEX, fragmentShaderSource:FRAGMENT, translucent:true,
      renderState:{ cull:{enabled:false},depthTest:{enabled:true},depthMask:false } }),
    asynchronous:false, allowPicking:false, scene3DOnly:true, compressVertices:false, show:false });
  primitive.orbitwatchRings = { id:data.id, profile:data.profile, vertices:data.vertices, seed:data.seed, bands:data.bands, representative:true };
  return primitive;
}

export function createPlanetaryRingLayer(scene, options = {}) {
  const fields = new Map();
  const sun = new Cartesian3(), centre = new Cartesian3(), relative = new Cartesian3(), inverse = new Matrix4(), scale = new Cartesian3();
  let quality = populationQuality(options.getQuality?.(),options.memoryGb ?? 8), destroyed = false, mask;
  function release(id) {
    const field = fields.get(id);
    if (!field) return;
    scene.primitives.remove(field.primitive); field.material.destroy(); fields.delete(id);
  }
  function prepare(id) {
    if (destroyed || !PLANETARY_RINGS[id]) return false;
    if (!fields.has(id)) {
      const primitive = ringPrimitive(generatePlanetaryRings(id,quality));
      fields.set(id,{ primitive:scene.primitives.add(primitive), material:primitive.appearance.material, alpha:0 });
    }
    return true;
  }
  function render(time) {
    if (destroyed) return;
    bodyPositionFixed("sun",time,sun);
    for (const [id,field] of fields) {
      const pose = options.getPose(id,time);
      Matrix4.clone(pose,field.primitive.modelMatrix);
      const radius = CELESTIAL_BODIES[id].radiusKm*1000;
      Cartesian3.fromElements(radius,radius,radius,scale);
      Matrix4.multiplyByScale(field.primitive.modelMatrix,scale,field.primitive.modelMatrix);
      Matrix4.getTranslation(pose,centre); Cartesian3.subtract(sun,centre,relative);
      Matrix4.inverseTransformation(pose,inverse); Matrix4.multiplyByPointAsVector(inverse,relative,relative);
      Cartesian3.normalize(relative,relative);
      const direction = field.material.uniforms.sunDirection;
      direction.x=relative.x; direction.y=relative.y; direction.z=relative.z;
    }
  }
  return {
    prepare, release,
    // Baked rings and body share a GLB primitive mesh. Runtime masking removes
    // only that existing ring surface; the original asset remains untouched.
    modelMask() {
      mask ||= new CustomShader({ fragmentShaderText:`void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        if (dot(fsInput.attributes.positionMC,fsInput.attributes.positionMC) > 1.44) material.alpha = 0.0;
      }` });
      return mask;
    },
    update(time,{ owners, elapsed=.032, reduced=false, live=true }) {
      if (destroyed) return;
      const next = populationQuality(options.getQuality?.(),options.memoryGb ?? 8);
      let carriedAlpha;
      if (quality !== next) {
        carriedAlpha = new Map([...fields].map(([id,field])=>[id,field.alpha]));
        for (const id of fields.keys()) release(id);
        quality=next;
      }
      for (const id of fields.keys()) if (!owners.has(id)) release(id);
      const camera = options.getCamera?.() ?? scene.camera;
      for (const [id,opacity] of owners) {
        if (!prepare(id)) continue;
        const field=fields.get(id), radius=CELESTIAL_BODIES[id].radiusKm*1000;
        if (carriedAlpha?.has(id)) field.alpha=carriedAlpha.get(id);
        Matrix4.getTranslation(options.getPose(id,time),centre);
        const distance=Cartesian3.distance(camera.positionWC,centre);
        const target=live ? opacity*ringVisibility(distance,radius,scene.canvas?.clientHeight || 720,camera.frustum?.fovy) : 0;
        field.alpha = reduced ? target : field.alpha+(target-field.alpha)*(1-Math.exp(-elapsed*8));
        field.primitive.show=field.alpha>.001 && live;
        field.material.uniforms.alpha=field.alpha;
      }
      render(time);
    }, render,
    destroy() { if (destroyed) return; for (const id of fields.keys()) release(id); mask?.destroy(); destroyed=true; },
  };
}
