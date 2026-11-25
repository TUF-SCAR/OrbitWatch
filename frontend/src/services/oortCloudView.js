import { Cartesian3, Matrix4 } from "cesium";
import { AU_METERS } from "../data/solarSystemEphemeris.js";
import { generateOortCloud, OORT_OUTER_AU, OORT_RENDER_DIVISOR, OORT_VIEW_MIN_AU, OORT_VIEW_MAX_AU, OORT_VIEW_START_AU, oortAuToScale, oortScaleToAu } from "../data/oortCloud.js";
import { populationQuality } from "../data/proceduralPopulations.js";
import { populationPrimitive } from "./proceduralPopulationLayer.js";
import { prefersReducedMotion } from "../utils/motionPreferences.js";

const RENDER_AU = AU_METERS / OORT_RENDER_DIVISOR;
const DURATION = 1650;

export function createOortCloudView(viewer, getSun, options) {
  const { scene, camera } = viewer;
  const controller = scene.screenSpaceCameraController;
  let saved, transition, field, yaw = 0, pitch = 0, range = OORT_VIEW_START_AU, blend = 0;
  const scale = new Cartesian3(AU_METERS, AU_METERS, AU_METERS);
  const aim = new Cartesian3(), right = new Cartesian3(), up = new Cartesian3();
  const position = new Cartesian3(), heading = new Cartesian3(), scratch = new Cartesian3();

  function pose() {
    return { position: Cartesian3.clone(camera.positionWC), direction: Cartesian3.clone(camera.directionWC), up: Cartesian3.clone(camera.upWC) };
  }
  function apply(destination, direction, vertical) {
    camera.setView({ destination, orientation: { direction, up: vertical } });
  }
  function begin(returning, instant = false) {
    transition = { returning, started: performance.now(), from: pose(), fromBlend: blend,
      duration: instant || prefersReducedMotion() ? 0 : DURATION };
    scene.requestRender();
  }
  function enter() {
    if (saved) return false;
    const offset = Cartesian3.normalize(Cartesian3.subtract(camera.positionWC, getSun(), scratch), scratch);
    yaw = Math.atan2(offset.y, offset.x);
    pitch = Math.max(-1.48, Math.min(1.48, Math.asin(offset.z)));
    range = OORT_VIEW_START_AU;
    saved = { ...pose(), near: camera.frustum.near, far: camera.frustum.far, inputs: controller.enableInputs };
    camera.cancelFlight();
    camera.lookAtTransform(Matrix4.IDENTITY);
    controller.enableInputs = false;
    begin(false);
    return true;
  }
  function clear() {
    if (!saved) return;
    camera.frustum.near = saved.near;
    camera.frustum.far = saved.far;
    controller.enableInputs = saved.inputs;
    if (field) {
      const material = field.appearance.material;
      scene.primitives.remove(field);
      material.destroy();
    }
    saved = transition = field = null;
    blend = 0;
  }
  function leave(instant = false) {
    if (!saved) return false;
    if (instant) { apply(saved.position, saved.direction, saved.up); clear(); }
    else if (!transition) begin(true);
    return true;
  }
  function update() {
    if (!saved) return;
    const sun = getSun(), cosPitch = Math.cos(pitch);
    Cartesian3.fromElements(cosPitch * Math.cos(yaw), cosPitch * Math.sin(yaw), Math.sin(pitch), aim);
    Cartesian3.add(sun, Cartesian3.multiplyByScalar(aim, range * RENDER_AU, position), position);
    Cartesian3.negate(aim, heading);
    Cartesian3.normalize(Cartesian3.cross(heading, Cartesian3.UNIT_Z, right), right);
    Cartesian3.cross(right, heading, up);
    if (transition) {
      const elapsed = transition.duration ? Math.min(1, (performance.now() - transition.started) / transition.duration) : 1;
      const t = elapsed * elapsed * (3 - 2 * elapsed);
      const { from, returning, fromBlend } = transition;
      Cartesian3.lerp(from.position, returning ? saved.position : position, t, position);
      Cartesian3.normalize(Cartesian3.lerp(from.direction, returning ? saved.direction : heading, t, heading), heading);
      Cartesian3.normalize(Cartesian3.lerp(from.up, returning ? saved.up : up, t, up), up);
      blend = fromBlend + ((returning ? 0 : 1) - fromBlend) * t;
      if (elapsed >= 1) {
        if (returning) { leave(true); return; }
        transition = null;
      } else scene.requestRender();
    }
    apply(position, heading, up);
    camera.frustum.near = Math.max(saved.near, range * .0001 * RENDER_AU);
    camera.frustum.far = Math.max(saved.far, (range + OORT_OUTER_AU * 1.1) * RENDER_AU);
    if (!field) field = scene.primitives.add(populationPrimitive(generateOortCloud(populationQuality(options.getQuality?.(), options.memoryGb)), "#acc9ff"));
    Matrix4.fromTranslation(sun, field.modelMatrix);
    Matrix4.multiplyByScale(field.modelMatrix, scale, field.modelMatrix);
    field.appearance.material.uniforms.tint.w = blend * 0.78;
    field.appearance.material.uniforms.density = 1;
    field.show = blend > .002;
  }
  function adjust(value) {
    if (!transition) {
      range = Math.max(OORT_VIEW_MIN_AU, Math.min(OORT_VIEW_MAX_AU, value));
      scene.requestRender();
    }
    return true;
  }
  return {
    enter, leave, update,
    destroy: clear,
    rotate(dx, dy) {
      if (transition) return;
      yaw -= dx * .004;
      pitch = Math.max(-1.48, Math.min(1.48, pitch + dy * .004));
      scene.requestRender();
    },
    zoom: ratio => adjust(range * ratio),
    setScale: value => adjust(oortScaleToAu(value)),
    get active() { return Boolean(saved); },
    get transitioning() { return Boolean(transition); },
    get blend() { return blend; },
    scale: () => ({ value: oortAuToScale(range), range: range * AU_METERS }),
  };
}
