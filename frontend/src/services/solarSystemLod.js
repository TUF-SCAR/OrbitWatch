import { ALL_CELESTIAL_IDS, CELESTIAL_BODIES } from "../data/celestialBodies.js";
import { AU_METERS, bodyOrbitalReference } from "../data/solarSystemEphemeris.js";

export const SOLAR_OVERVIEW_IDS = ["sun", "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];
export const MAX_SOLAR_RANGE = 240 * AU_METERS;

export function solarSystemScales(id) {
  const body = CELESTIAL_BODIES[id];
  const parent = body.type === "Moon" ? body.parent : id;
  const family = ALL_CELESTIAL_IDS.filter((key) => key === parent || CELESTIAL_BODIES[key].parent === parent && CELESTIAL_BODIES[key].type === "Moon");
  const radius = Math.max(100, body.radiusKm * 1000);
  const extent = Math.max(CELESTIAL_BODIES[parent].radiusKm * 1000 * 8, ...family.map((key) => {
    const orbit = bodyOrbitalReference(key);
    return CELESTIAL_BODIES[key].type === "Moon" ? orbit.semimajorKm * 1000 * (1 + orbit.eccentricity) : 0;
  }));
  const solarScale = (bodyOrbitalReference(parent)?.semimajorAu || 1) * AU_METERS;
  return { parent, family, radius, localStart: radius * 8, localEnd: Math.max(radius * 24, extent * 1.2),
    solarStart: Math.max(extent * 8, solarScale * 0.06), solarEnd: Math.max(extent * 24, solarScale * 0.45),
    overviewStart: Math.max(2 * AU_METERS, solarScale * 0.7), overviewEnd: Math.max(40 * AU_METERS, solarScale * 2.5) };
}

// Logarithmic distance gives a gradual reveal across astronomical scales.
export function distanceFade(distance, start, end, reduced = false) {
  if (reduced) return distance >= Math.sqrt(start * end) ? 1 : 0;
  const t = Math.max(0, Math.min(1, Math.log(Math.max(distance, start) / start) / Math.log(end / start)));
  return t * t * (3 - 2 * t);
}

export const LOD_STAGES = ["close", "local-system", "heliocentric", "overview"];

// Distinct enter/exit boundaries stabilize stage changes. Fades remain a
// separate continuous visual policy and never alter scientific positions.
export function stableLodStage(scales, range, previous = "close") {
  const boundaries = [scales.localStart, scales.solarStart, scales.overviewStart];
  let index = Math.max(0, LOD_STAGES.indexOf(previous));
  while (index < 3 && range >= boundaries[index] * 1.15) index++;
  while (index > 0 && range < boundaries[index - 1] * 0.85) index--;
  return LOD_STAGES[index];
}

export function representationWeights(distance, radius, previous = false, reduced = false) {
  const symbolic = reduced ? distance >= radius * (previous ? 26 : 36) : distanceFade(distance, radius * 28, radius * 44);
  // Physical fades out first. A marker never protrudes from a visible limb;
  // model and fallback are exclusive owners of the physical phase.
  const physical = reduced ? 1 - Number(symbolic) : 1 - distanceFade(distance, radius * 18, radius * 28);
  return { physical, symbolic };
}

// Keep the opaque imaged globe until its disc matches a screen-space marker.
// The centered marker is occluded by the globe before ownership changes, so
// neither a disappearing Earth nor a dot protruding through its limb occurs.
export function surfaceSymbolicHandoff(distance, radius, height, fov, previous = false) {
  const diameter = height * radius / (Math.max(distance, radius) * Math.tan(fov / 2));
  return diameter <= (previous ? 11 : 9);
}

export function rangeToScale(range, minimum) {
  return Math.max(0, Math.min(1, Math.log(Math.max(range, minimum) / minimum) / Math.log(MAX_SOLAR_RANGE / minimum)));
}
export function scaleToRange(value, minimum) {
  return minimum * (MAX_SOLAR_RANGE / minimum) ** Math.max(0, Math.min(1, value));
}

export function solarSystemLod(scales, range, reduced = false, previous = "close") {
  const local = distanceFade(range, scales.localStart, scales.localEnd, reduced);
  const solar = distanceFade(range, scales.solarStart, scales.solarEnd, reduced);
  const overview = distanceFade(range, scales.overviewStart, scales.overviewEnd, reduced);
  const stage = stableLodStage(scales, range, previous);
  if (reduced) { const index = LOD_STAGES.indexOf(stage); return { local: Number(index >= 1), solar: Number(index >= 2), overview: Number(index >= 3), stage }; }
  return { local, solar, overview, stage };
}
