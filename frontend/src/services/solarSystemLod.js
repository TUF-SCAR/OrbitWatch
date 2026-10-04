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

export function solarSystemLod(scales, range, reduced = false) {
  const local = distanceFade(range, scales.localStart, scales.localEnd, reduced);
  const solar = distanceFade(range, scales.solarStart, scales.solarEnd, reduced);
  const overview = distanceFade(range, scales.overviewStart, scales.overviewEnd, reduced);
  return { local, solar, overview, stage: overview > 0 ? "overview" : solar > 0 ? "heliocentric" : local > 0 ? "local-system" : "close" };
}
