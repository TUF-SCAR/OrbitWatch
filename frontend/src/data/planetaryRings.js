import { CELESTIAL_BODIES } from "./celestialBodies.js";
import { populationQuality, seededRandom } from "./proceduralPopulations.js";

// Radial subsets in km from the planet centre, NASA/PDS references in
// docs/CELESTIAL_ENVIRONMENT.md. Color/opacity/grain are illustrative.
// Narrow ringlets retain their real widths; filtering integrates subpixel area.
const band = (inner, outer, opacity, color) => ({ inner, outer, opacity, color });
const narrow = (radius, width, opacity, color) => band(radius-width/2,radius+width/2,opacity,color);
export const PLANETARY_RINGS = {
  jupiter: { seed: 1, bands: [
    band(100000,122400,.008,[.57,.51,.45]), band(122400,129100,.12,[.69,.61,.51]),
    band(129100,181350,.003,[.55,.49,.42]), band(181350,221900,.0015,[.51,.46,.40]),
  ] },
  saturn: { seed: 2, bands: [
    band(74658,91975,.30,[.63,.58,.49]), band(91975,117507,.86,[.86,.80,.67]),
    band(122340,133410,.62,[.79,.75,.66]), band(133735,136487,.56,[.76,.72,.63]),
    band(136529,136780,.48,[.73,.69,.60]), narrow(139851,50,.50,[.81,.78,.69]),
  ] },
  uranus: { seed: 3, bands: [
    narrow(39600,3500,.065,[.39,.46,.47]),
    ...[[41837,1.5],[42234,2],[42571,2],[44718,7],[45661,8],[47176,1.6],[47627,2.5],[48300,4.6],[50024,2.3],[51149,58.1]]
      .map(([radius,width])=>narrow(radius,width,.48,[.53,.58,.56])),
    narrow(67300,3800,.016,[.47,.39,.35]), narrow(97700,17000,.012,[.33,.46,.58]),
  ] },
  neptune: { seed: 4, bands: [
    narrow(42000,2000,.055,[.38,.43,.47]), narrow(53200,100,.32,[.49,.52,.54]),
    narrow(55200,4000,.035,[.34,.40,.44]), narrow(62933,15,.48,[.54,.56,.58]),
  ] },
};
export const RING_PROFILES = { performance:{ angular:96, radial:3 }, balanced:{ angular:160, radial:5 }, quality:{ angular:256, radial:8 } };

export function generatePlanetaryRings(id, quality = "balanced") {
  const system = PLANETARY_RINGS[id];
  if (!system) throw new Error(`No procedural rings for ${id}`);
  const profile = RING_PROFILES[populationQuality(quality)], radius = CELESTIAL_BODIES[id].radiusKm;
  const positions = [], colors = [], limits = [], indices = [];
  const random = seededRandom(`orbitwatch-rings-v1:${id}`);
  for (const entry of system.bands) {
    const inner = entry.inner/radius, outer = entry.outer/radius;
    const rows = outer-inner > .025 ? profile.radial : 1;
    const offset = positions.length/3;
    // Raster padding only: fragment coverage retains sourced radial boundaries.
    for (let row = 0; row <= rows; row++) {
      const r = inner-.04+(outer-inner+.08)*row/rows;
      const tint = .92 + random()*.08;
      for (let n = 0; n <= profile.angular; n++) {
        const angle = n/profile.angular*Math.PI*2;
        positions.push(r*Math.cos(angle),r*Math.sin(angle),0);
        colors.push(...entry.color.map(value=>value*tint),entry.opacity);
        limits.push(inner,outer);
      }
    }
    for (let row = 0; row < rows; row++) for (let n = 0; n < profile.angular; n++) {
      const a = offset+row*(profile.angular+1)+n, b = a+profile.angular+1;
      indices.push(a,b,a+1,a+1,b,b+1);
    }
  }
  return { id, seed:system.seed, positions:new Float64Array(positions), colors:new Float32Array(colors), limits:new Float32Array(limits), indices:new Uint16Array(indices),
    vertices:positions.length/3, bands:system.bands.length, profile:populationQuality(quality) };
}
