import { CELESTIAL_BODIES } from "./celestialBodies.js";
import { bodyOrbitalReference } from "./solarSystemEphemeris.js";
import { CELESTIAL_NOTES } from "./celestialNotes.js";

export const BODY_SOURCES = [
  { label: "NASA · Solar System", url: "https://science.nasa.gov/solar-system/" },
  { label: "JPL · Approximate planetary positions", url: "https://ssd.jpl.nasa.gov/planets/approx_pos.html" },
  { label: "JPL · Natural satellites", url: "https://ssd.jpl.nasa.gov/sats/" },
];
export function bodyReferenceFacts(id) {
  const body = CELESTIAL_BODIES[id];
  if (!body) return [];
  const orbit = bodyOrbitalReference(id);
  const children = Object.values(CELESTIAL_BODIES).filter((item) => item.parent === id && item.type === "Moon");
  const facts = [
    `${body.name} is classified as a ${body.type.toLowerCase()}.`,
    `The catalog reference radius is approximately ${body.radiusKm.toLocaleString()} km.`,
    `The corresponding reference diameter is approximately ${(body.radiusKm * 2).toLocaleString()} km.`,
  ];
  if (body.parent) facts.push(`${body.name} orbits ${CELESTIAL_BODIES[body.parent]?.name || body.parent}.`);
  if (orbit) {
    facts.push(`Its model orbital period is approximately ${orbit.periodDays.toLocaleString(undefined, { maximumFractionDigits: 3 })} Earth days.`);
    facts.push(`Its reference semimajor axis is ${orbit.semimajorAu ? `${orbit.semimajorAu.toFixed(3)} AU` : `${orbit.semimajorKm.toLocaleString()} km`}.`);
    facts.push(`Its reference orbital eccentricity is ${orbit.eccentricity.toFixed(4)}.`);
    facts.push(`Its model orbital inclination is ${Math.abs(orbit.inclination).toFixed(2)}°; moon reference planes are simplified.`);
    const unit = orbit.semimajorAu ? "AU" : "km", a = orbit.semimajorAu || orbit.semimajorKm;
    const format = (value) => value.toLocaleString(undefined, { maximumFractionDigits: orbit.semimajorAu ? 3 : 0 });
    facts.push(`The model's closest parent-center distance is ${format(a * (1 - orbit.eccentricity))} ${unit}.`);
    facts.push(`The model's farthest parent-center distance is ${format(a * (1 + orbit.eccentricity))} ${unit}.`);
  }
  if (children.length) facts.push(`Explore ${children.length} of ${body.name}'s moons in this catalog: ${children.map((item) => item.name).join(", ")}.`);
  if (body.rings) facts.push(`${body.name} has a ring system; its visible rings here are schematic.`);
  return facts;
}
export function bodyFacts(id) { return [...(CELESTIAL_NOTES[id] || []), ...bodyReferenceFacts(id)]; }
const VOYAGER_SATURN_MOONS = ["mimas", "tethys", "dione", "rhea", "iapetus"];
export function bodyCoverageNote(id) {
  if (id === "pluto") return "PARTIAL SURFACE MAP · BLACK AREAS HAVE NO IMAGERY";
  if (id === "enceladus") return "CASSINI REFERENCE MAP · ENHANCED COLOR";
  return VOYAGER_SATURN_MOONS.includes(id) ? "HISTORICAL VOYAGER MAP · UNEVEN COVERAGE" : null;
}
export function bodyRepresentation(id) {
  if (id === "earth") return "Earth imagery from the selected map provider; the auth preview uses a separate reference map.";
  if (id === "enceladus") return "NASA/JPL-Caltech/Space Science Institute/Lunar and Planetary Institute Cassini mosaic (2004–2014), PIA18435. Enhanced infrared/green/ultraviolet color extends beyond human vision. Historical cylindrical reference map on OrbitWatch geometry; resolution varies and orientation and shape are approximate. No measured terrain displacement or live imagery is shown.";
  if (id === "ceres") return "Cylindrical reference map from NASA VTAD's Ceres model, reduced to 2048 pixels wide on OrbitWatch geometry. Historical appearance; map alignment, body orientation and shape are approximate. No measured terrain displacement or live imagery is shown.";
  if (id === "mercury") return "NASA / Johns Hopkins APL / Carnegie MESSENGER global mosaic (2012) on an OrbitWatch sphere. Reduced-resolution grayscale reference with polar gaps and approximate orientation; not live imagery or measured terrain displacement.";
  if (id === "pluto") return "NASA / Johns Hopkins APL / SwRI New Horizons color mosaic from the July 2015 flyby on an OrbitWatch sphere. Black southern regions have no imagery; they are not a simulated night side. Resolution varies across the map, and body orientation is approximate.";
  if (id === "venus") return "NASA/JPL Magellan radar mosaic, color enhanced to reveal the surface beneath the clouds. Not a visible-light photograph.";
  if (id === "moon") return "NASA Scientific Visualization Studio / LRO color map on a reference sphere. Polar coverage is reconstructed; no measured terrain displacement is shown.";
  if (id === "bennu") return "NASA VTAD reference geometry with a 2019 OSIRIS-REx / NASA SVS surface mosaic. Reduced detail; shape-to-map alignment and orientation are approximate, not navigation-grade terrain or live imagery.";
  if (id === "io") return "JPL/Caltech/USGS Voyager mosaic with Galileo reference color on an OrbitWatch sphere. Historical appearance with polar gaps; orientation is approximate, not live imagery or measured terrain.";
  if (VOYAGER_SATURN_MOONS.includes(id)) return "JPL/Caltech/USGS cleaned-up Voyager grayscale mosaic on OrbitWatch geometry. Coverage is uneven: smooth or blurred regions are gaps or reconstruction, not measured smooth terrain. This historical map predates Cassini; orientation and shape are approximate, without measured displacement.";
  if (["europa", "ganymede", "callisto"].includes(id)) return "JPL/Caltech/USGS Voyager mosaic on an OrbitWatch sphere. Cleaned-up historical reference map; coverage and color may be reconstructed. Orientation is approximate, not live imagery or measured terrain.";
  if (["mars", "phobos", "deimos", "jupiter", "saturn", "neptune"].includes(id)) return "NASA/JPL reference texture on OrbitWatch geometry. Historical appearance; coverage and color may be reconstructed. Not live imagery or measured terrain.";
  return "Illustrative procedural surface · not a measured shape or photographic surface map.";
}
export function bodyTextureSource(id) {
  if (id === "enceladus") return "https://science.nasa.gov/photojournal/color-maps-of-enceladus-2014/";
  if (VOYAGER_SATURN_MOONS.includes(id)) return "https://space.jpl.nasa.gov/tmaps/saturn.html";
  if (id === "ceres") return "https://science.nasa.gov/resource/ceres-3d-model/";
  if (id === "mercury") return "https://science.nasa.gov/photojournal/a-world-view/";
  if (id === "pluto") return "https://science.nasa.gov/resource/pluto-global-color-map/";
  if (id === "moon") return "https://svs.gsfc.nasa.gov/4720/";
  if (id === "bennu") return "https://svs.gsfc.nasa.gov/5069/";
  if (["io", "europa", "ganymede", "callisto"].includes(id)) return "https://space.jpl.nasa.gov/tmaps/jupiter.html";
  if (["mars", "phobos", "deimos"].includes(id)) return "https://space.jpl.nasa.gov/tmaps/mars.html";
  return ["venus", "jupiter", "saturn", "neptune"].includes(id) ? `https://science.nasa.gov/3d-resources/${id}/` : null;
}
