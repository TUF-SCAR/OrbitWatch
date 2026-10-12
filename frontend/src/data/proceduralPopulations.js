// Representative distributions, never catalogued objects. See
// docs/CELESTIAL_ENVIRONMENT.md for sources and deliberate sampling choices.
export const POPULATION_SEED = "orbitwatch-solar-v1";
export const POPULATION_KINDS = ["main-belt", "trojans", "kuiper", "scattered"];
export const POPULATION_CAPS = {
  performance: [650, 240, 600, 80], balanced: [1400, 480, 1400, 140], quality: [2600, 800, 2600, 240],
};

export function seededRandom(seed) {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function populationQuality(value = "auto", memoryGb = 8) {
  return POPULATION_CAPS[value] ? value : memoryGb <= 4 ? "performance" : memoryGb > 8 ? "quality" : "balanced";
}

const TAU = Math.PI * 2, RAD = Math.PI / 180;
function mainAxis(random) {
  // Four Jupiter mean-motion resonances produce depleted semimajor-axis bands.
  const gaps = [2.5, 2.82, 2.96, 3.28];
  for (let attempt = 0; attempt < 32; attempt++) {
    const a = 2.2 + random() * 1.1;
    if (gaps.every(gap => Math.abs(a - gap) > .022) || random() < .08) return a;
  }
  return 2.7; // Bounded generation even for an unusually long rejection streak.
}

export function generatePopulation(kind, quality = "balanced", seed = POPULATION_SEED) {
  const index = POPULATION_KINDS.indexOf(kind);
  if (index < 0) throw new Error(`Unknown population: ${kind}`);
  const count = POPULATION_CAPS[populationQuality(quality)][index];
  const random = seededRandom(`${seed}:${kind}`);
  const positions = new Float64Array(count * 3), elements = new Float64Array(count * 6), styles = new Float32Array(count * 4);
  for (let n = 0; n < count; n++) {
    let a, e, inclination, node = random() * TAU, peri = random() * TAU, mean = random() * TAU;
    if (kind === "main-belt") {
      a = mainAxis(random); e = .025 + random() ** 1.5 * .18;
      inclination = (random() ** 1.6 * 23 + 1) * RAD;
    } else if (kind === "trojans") {
      a = 5.202887 + (random() + random() - 1) * .3;
      e = .015 + random() * .07; inclination = random() ** 1.4 * 28 * RAD;
      // Diffuse islands, not a ring. Longitude measured from Jupiter's current
      // heliocentric direction; +/-60 degrees plus bounded libration spread.
      mean = (n % 2 ? -1 : 1) * Math.PI / 3 + (random() + random() + random() - 1.5) * .23;
      peri = 0; node = 0;
    } else if (kind === "kuiper") {
      // A cold core plus a thicker high-inclination component. Perihelion and
      // aphelion stay in this representative main-region subset (30..50 AU).
      a = 32 + random() * 16;
      e = Math.min((a - 30) / a, (50 - a) / a, .025 + random() * .13);
      inclination = (random() < .7 ? random() ** 1.8 * 6 : 8 + random() * 24) * RAD;
    } else {
      a = 52 + random() * 38;
      e = 1 - (30 + random() * 8) / a;
      inclination = (10 + random() * 35) * RAD;
    }
    let anomaly = mean;
    for (let k = 0; k < 8; k++) anomaly -= (anomaly - e * Math.sin(anomaly) - mean) / (1 - e * Math.cos(anomaly));
    const x = a * (Math.cos(anomaly) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(anomaly);
    const co = Math.cos(node), so = Math.sin(node), cp = Math.cos(peri), sp = Math.sin(peri), ci = Math.cos(inclination), si = Math.sin(inclination);
    const p = n * 3, s = n * 4, o = n * 6;
    // AU coordinates keep GPU attributes small. Quantization stabilizes the
    // immutable visual buffers across platforms; these are not ephemerides.
    positions[p] = Math.round(((co * cp - so * sp * ci) * x + (-co * sp - so * cp * ci) * y) * 1e10) / 1e10;
    positions[p + 1] = Math.round(((so * cp + co * sp * ci) * x + (-so * sp + co * cp * ci) * y) * 1e10) / 1e10;
    positions[p + 2] = Math.round((sp * si * x + cp * si * y) * 1e10) / 1e10;
    elements.set([a, e, inclination, node, peri, mean], o);
    styles[s] = 1.4 + random() ** 3 * 1.0; // pixels, well below named markers
    styles[s + 1] = .45 + random() ** 2 * .55;
    styles[s + 2] = random(); // stable nested density rank
    styles[s + 3] = random(); // restrained tint variation
  }
  return { kind, seed, count, positions, elements, styles, representative: true };
}

export function generateStars(seed = "orbitwatch-stars-v1", count = 9000) {
  const random = seededRandom(seed), stars = new Float64Array(count * 5);
  for (let n = 0; n < count; n++) {
    const longitude = random() * TAU;
    // An extremely faint density band; no measured star identities claimed.
    const z = n % 4 === 0 ? (random() + random() - 1) * .13 : random() * 2 - 1;
    const radial = Math.sqrt(1 - z * z), y = radial * Math.sin(longitude);
    stars.set([radial * Math.cos(longitude), y * .85 - z * .5267826876, y * .5267826876 + z * .85,
      .18 + random() ** 5 * .82, random()], n * 5);
  }
  return stars;
}
