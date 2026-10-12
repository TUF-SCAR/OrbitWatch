import { Cartesian3, Color } from "cesium";
import { createOrbitStroke, OrbitStrokeMaterialProperty } from "./orbitStroke.js";
import { createSatelliteOrbitMaterial } from "./satelliteOrbitMaterial.js";
import { satelliteFrame, satelliteOrbitPhase, satelliteOrbitRefreshDue } from "./satelliteOrbitState.js";

// Temporal emphasis and density hierarchy; scientific positions live separately.
export function satelliteOrbitStyle(selected, count, height = 27000000, radius = 0) {
  // Bound the combined context opacity even when many sampled paths overlap.
  const crowd = Math.min(1, 6 / Math.max(1, count));
  const start = Math.max(35000000, radius * 1.5), end = Math.max(100000000, radius * 5);
  const wide = 1 - Math.max(0, Math.min(1, (height - start) / (end - start)));
  return { width: selected ? 3.2 : 2.6, alpha: (selected ? 0.72 : 0.19 * crowd) * wide,
    base: (selected ? .2 : .075 * crowd) * wide, glow: selected ? 0.55 : 0.42 };
}

export function styleSatelliteOrbit(data, color, selected, count, height) {
  const line = data.orbitEntity?.polyline;
  if (!line) return;
  if (!data.orbitVisual || data.orbitVisual.line !== line) {
    const tint = Color.clone(color);
    const material = new OrbitStrokeMaterialProperty({ color: tint });
    data.orbitVisual = { line, tint, material };
    line.material = material;
  }
  const style = satelliteOrbitStyle(selected, count, height, data.orbitState?.radius), visual = data.orbitVisual;
  visual.tint.alpha = style.alpha;
  visual.material.color.setValue(visual.tint);
  visual.material.glowPower.setValue(style.glow);
  line.width = style.width;
  if (data.orbitLine) {
    const gpu = data.orbitLine;
    gpu.width = style.width; gpu.core = style.glow;
    gpu.show = data.orbitEntity.show && style.alpha > 0;
    const tint = gpu.material.uniforms.color;
    tint.x = color.red; tint.y = color.green; tint.z = color.blue; tint.w = style.alpha;
    if ("baseAlpha" in gpu.material.uniforms) gpu.material.uniforms.baseAlpha = style.base;
  }
}

export function attachSatelliteOrbit(data, collection, positions, state) {
  // Entity retains the world-space path and visibility interface, but has no
  // renderer. Exactly one resident primitive owns each sampled orbit.
  data.orbitEntity.polyline.show = false;
  if (data.orbitLine) data.orbitLine.positions = positions;
  else data.orbitLine = collection.add({ id: data.orbitEntity, positions,
    material: state ? createSatelliteOrbitMaterial(data.orbitVisual.tint) : createOrbitStroke(data.orbitVisual.tint), show: data.orbitEntity.show, pickable:true });
  if (state) {
    data.orbitState = state;
    data.orbitLine.modelMatrix = state.matrix;
    data.orbitLine.orbitwatchSatellite = { state, track:data.track };
    data.orbitEpoch = data.trajectory?.tle_epoch;
  }
}

export function satelliteOrbitNeedsRefresh(data) {
  return !data.orbitLine || satelliteOrbitRefreshDue(data);
}

export function removeSatelliteOrbit(data, collection) {
  if (data.orbitLine) collection?.remove(data.orbitLine);
  data.orbitLine = null;
  data.orbitVisual = null;
  data.orbitState = null;
}

const satellitePoint = new Cartesian3();
export function updateSatelliteOrbit(data, time) {
  const state = data.orbitState, track = data.track;
  if (!state || !track || !data.orbitLine) return;
  const effective = track.effectiveTime(time);
  satelliteFrame(effective, state.matrix);
  const uniforms = data.orbitLine.material.uniforms;
  uniforms.phase = satelliteOrbitPhase(state, track.inertialAt(effective, satellitePoint), effective);
  state.stale = data.orbitEpoch !== data.trajectory?.tle_epoch || state.distance > Math.max(1500, state.radius * .00015);
  uniforms.current = track.isStale(time) || state.stale ? 0 : 1;
}

export function solarOrbitStyle({ moon, selected, local, solar, overview }) {
  if (moon) return { width: selected ? 2.8 : 2.5, alpha: (selected ? 0.2 : local * 0.12) * (1 - solar) };
  return { width: selected ? 2.8 : 2.5,
    alpha: selected ? solar * (0.24 - overview * 0.08) : Math.max(0, (overview - 0.25) / 0.75) * 0.085 };
}
