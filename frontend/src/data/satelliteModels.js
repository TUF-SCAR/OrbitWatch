// Reviewed object-specific assets only. Legacy procedural GLBs are not exact models.
export const VERIFIED_SATELLITE_MODELS = {
  20580: { url: "/models/satellites/verified/hubble.glb", source: "https://science.nasa.gov/3d-resources/hubble-space-telescope-a/", credit: "NASA / DigitalSpace Corporation", note: "Historical mission configuration; not a live attitude model." },
};
export function getSatelliteModelUrl(object) { return VERIFIED_SATELLITE_MODELS[Number(object?.noradId)]?.url || null; }
export function getSatelliteModelKind(object) { return String(object?.name || "SATELLITE").toUpperCase(); }
