import { seededRandom } from "./proceduralPopulations.js";

export const OORT_INNER_AU = 5_000;
export const OORT_OUTER_AU = 100_000;
export const OORT_RENDER_DIVISOR = 128;
export const OORT_VIEW_MIN_AU = 16_000;
export const OORT_VIEW_MAX_AU = 240_000;
export const OORT_VIEW_START_AU = 165_000;
const COUNTS = { performance: 2400, balanced: 4600, quality: 6800 };

export function generateOortCloud(quality, seed = "orbitwatch-oort-v1") {
  const count = COUNTS[quality] ?? COUNTS.balanced;
  const random = seededRandom(seed);
  const positions = new Float64Array(count * 3), styles = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const z = 2 * random() - 1, azimuth = 2 * Math.PI * random();
    const radial = (random() + random() + random()) / 3;
    const radius = OORT_INNER_AU + radial ** 1.35 * (OORT_OUTER_AU - OORT_INNER_AU);
    const plane = Math.sqrt(1 - z * z), r = radius / OORT_RENDER_DIVISOR;
    positions.set([r * plane * Math.cos(azimuth), r * plane * Math.sin(azimuth), r * z], i * 3);
    const glint = random() ** 5;
    const variation = 0.78 + 0.22 * Math.sin(azimuth * 3 + z * 3) ** 2;
    styles.set([1.65 + 2.25 * glint, (.30 + .62 * glint) * variation, random(), glint], i * 4);
  }
  return { kind: "oort", seed, count, positions, styles };
}

export function oortScaleToAu(scale) {
  return OORT_VIEW_MIN_AU * (OORT_VIEW_MAX_AU / OORT_VIEW_MIN_AU) ** Math.max(0, Math.min(1, scale));
}

export function oortAuToScale(au) {
  return Math.max(0, Math.min(1, Math.log(au / OORT_VIEW_MIN_AU) / Math.log(OORT_VIEW_MAX_AU / OORT_VIEW_MIN_AU)));
}
