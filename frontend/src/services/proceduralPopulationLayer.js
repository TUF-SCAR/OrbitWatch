import { Appearance, BoundingSphere, Cartesian3, Color, ComponentDatatype, Geometry, GeometryAttribute, GeometryInstance, Material, Matrix3, Matrix4, Primitive, PrimitiveType } from "cesium";
import { AU_METERS, bodyOrbitalReference, bodyPositionFixed, inertialToFixedMatrix } from "../data/solarSystemEphemeris.js";
import { CELESTIAL_BODIES } from "../data/celestialBodies.js";
import { generatePopulation, POPULATION_KINDS, populationQuality } from "../data/proceduralPopulations.js";
import { distanceFade } from "./solarSystemLod.js";

const DENSITY_DISTANCE = { "main-belt":35, trojans:40, kuiper:180, scattered:240 };

export function populationVisibility(kind, rangeAu, solar, outer = false) {
  const bounds = kind === "main-belt" ? [.55, 3] : kind === "trojans" ? [.9, 5]
    : kind === "kuiper" ? outer ? [1.5, 10] : [12, 42] : [20, 85];
  return solar * distanceFade(rangeAu, ...bounds);
}

export function populationDensity(kind, eyeDistanceAu, visibility) {
  // Approximate projected area: compressed inner populations must not become
  // an opaque ring at overview scale. Stable ranks thin the same seeded field.
  const fullDistance = DENSITY_DISTANCE[kind];
  const area = Math.min(1, (fullDistance / Math.max(fullDistance, eyeDistanceAu)) ** 2);
  return (.25 + visibility * .75) * Math.max(.06, area);
}

const VERTEX = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec4 populationStyle;
in float batchId;
out vec4 v_population;
void main() {
  vec4 p = czm_computePosition();
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
  gl_PointSize = populationStyle.x * czm_pixelRatio;
  v_population = populationStyle;
}`;
const SOURCE = `
in vec4 v_population;
czm_material czm_getMaterial(czm_materialInput inputData) {
  czm_material result = czm_getDefaultMaterial(inputData);
  float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float coverage = 1.0 - smoothstep(0.3, 1.0, radius);
  float reveal = smoothstep(v_population.z - 0.035, v_population.z + 0.035, density);
  result.diffuse = tint.rgb * mix(0.88, 1.0, v_population.w);
  result.alpha = tint.a * v_population.y * coverage * reveal;
  return result;
}`;
const FRAGMENT = `
void main() {
  czm_materialInput inputData;
  inputData.st = gl_PointCoord;
  czm_material value = czm_getMaterial(inputData);
  if (value.alpha < 0.002) discard;
  out_FragColor = vec4(value.diffuse, value.alpha);
}`;
const COLORS = { "main-belt":"#a99681", trojans:"#9b8a73", kuiper:"#87a6ba", scattered:"#728b9c" };
const MAX_ALPHA = { "main-belt":.42, trojans:.30, kuiper:.40, scattered:.20 };
const EXTENT = { "main-belt":4, trojans:6, kuiper:50, scattered:150 };

export function populationPrimitive(data) {
  const color = Color.fromCssColorString(COLORS[data.kind]);
  const material = new Material({ fabric: { type:"OrbitWatchPopulationV1", uniforms: { tint:{ type:"vec4", x:color.red, y:color.green, z:color.blue, w:0 }, density:0 }, source:SOURCE }, translucent:true });
  const geometry = new Geometry({ attributes: {
    position:new GeometryAttribute({ componentDatatype:ComponentDatatype.DOUBLE, componentsPerAttribute:3, values:data.positions }),
    populationStyle:new GeometryAttribute({ componentDatatype:ComponentDatatype.FLOAT, componentsPerAttribute:4, values:data.styles }),
  }, primitiveType:PrimitiveType.POINTS, boundingSphere:BoundingSphere.fromVertices(data.positions) });
  const primitive = new Primitive({ geometryInstances:new GeometryInstance({ geometry }),
    appearance:new Appearance({ material, vertexShaderSource:VERTEX, fragmentShaderSource:FRAGMENT, translucent:true, renderState:{ depthTest:{ enabled:true }, depthMask:false } }),
    asynchronous:false, allowPicking:false, scene3DOnly:true, compressVertices:false, vertexCacheOptimize:false, show:false });
  primitive.orbitwatchPopulation = { kind:data.kind, count:data.count, seed:data.seed, representative:true };
  return primitive;
}

// Four bounded draw calls. Immutable AU buffers; time/camera changes update
// only matrices/uniforms, never thousands of particle JS objects.
export function createProceduralPopulationLayer(scene, options = {}) {
  const fields = new Map(), alpha = new Map(POPULATION_KINDS.map(kind => [kind,0]));
  const tilt = Matrix3.fromRotationX(23.43928 * Math.PI / 180);
  const fixed = new Matrix3(), rotation = new Matrix3(), inverse = new Matrix3(), trojanRotation = new Matrix3();
  const sun = new Cartesian3(), jupiter = new Cartesian3(), relative = new Cartesian3(), ecliptic = new Cartesian3();
  const scale = new Cartesian3(AU_METERS, AU_METERS, AU_METERS);
  let quality, destroyed = false, context = "", extent = 0;
  function clear() { for (const field of fields.values()) { scene.primitives.remove(field.primitive); field.material.destroy(); } fields.clear(); }
  function render(time) {
    if (destroyed || !extent) return;
    bodyPositionFixed("sun",time,sun);
    inertialToFixedMatrix(time,fixed); Matrix3.multiply(fixed,tilt,rotation);
    bodyPositionFixed("jupiter",time,jupiter);
    Cartesian3.subtract(jupiter,sun,relative);
    Matrix3.multiplyByVector(Matrix3.transpose(rotation,inverse),relative,ecliptic);
    Matrix3.multiply(rotation,Matrix3.fromRotationZ(Math.atan2(ecliptic.y,ecliptic.x),trojanRotation),trojanRotation);
    for (const [kind,field] of fields) {
      Matrix4.fromRotationTranslation(kind === "trojans" ? trojanRotation : rotation,sun,field.primitive.modelMatrix);
      Matrix4.multiplyByScale(field.primitive.modelMatrix,scale,field.primitive.modelMatrix);
    }
    if (scene.camera?.frustum) scene.camera.frustum.far = Math.max(scene.camera.frustum.far, Cartesian3.distance(scene.camera.positionWC,sun) + extent * AU_METERS * 1.05);
  }
  return {
    update(time, { range, solar, selectedId, live = true, elapsed = .032, reduced = false }) {
      if (destroyed) return;
      const nextQuality = populationQuality(options.getQuality?.(), options.memoryGb ?? 8);
      if (nextQuality !== quality) { clear(); quality = nextQuality; }
      const body = CELESTIAL_BODIES[selectedId], parent = body?.type === "Moon" ? body.parent : selectedId;
      const outer = (bodyOrbitalReference(parent)?.semimajorAu ?? 0) >= 19;
      bodyPositionFixed("sun",time,sun);
      const eyeDistanceAu = scene.camera?.positionWC ? Cartesian3.distance(scene.camera.positionWC,sun) / AU_METERS : range / AU_METERS;
      extent = 0; context = "";
      for (const kind of POPULATION_KINDS) {
        const target = live ? populationVisibility(kind, range / AU_METERS, solar, outer) : 0;
        // A completed travel handoff must not carry wide-context opacity into
        // an ordinary destination view. Scale-based reveals still fade normally.
        const value = reduced || !live || solar === 0 ? target : alpha.get(kind) + (target - alpha.get(kind)) * (1 - Math.exp(-elapsed * 6));
        alpha.set(kind,value);
        let field = fields.get(kind);
        if (value > .002 && !field) {
          const data = generatePopulation(kind, quality), primitive = populationPrimitive(data);
          field = { primitive:scene.primitives.add(primitive), material:primitive.appearance.material, count:data.count };
          fields.set(kind,field);
        }
        if (!field) continue;
        field.primitive.show = value > .002 && live;
        field.material.uniforms.tint.w = value * MAX_ALPHA[kind];
        field.material.uniforms.density = populationDensity(kind,eyeDistanceAu,value);
        if (field.primitive.show) { extent = Math.max(extent, EXTENT[kind]); context += (context ? " · " : "") + kind; }
      }
      render(time);
    },
    render,
    context: () => context,
    destroy() { if (destroyed) return; clear(); alpha.clear(); destroyed = true; },
  };
}
