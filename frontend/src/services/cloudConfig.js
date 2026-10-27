// Display budgets, not additional scientific resolution. One WMS image per frame.
export const CLOUD_SOURCE = Object.freeze({
  url: 'https://view.eumetsat.int/geoserver/wms',
  layer: 'mumi:worldcloudmap_ir108',
  credit: 'EUMETSAT / NOAA / JMA · geostationary infrared composite',
  information: 'https://view.eumetsat.int/productviewer/productDetails/mumi%3Aworldcloudmap_ir108',
});
export const CLOUD_PROFILES = Object.freeze({
  performance: { width: 1024, frames: 2 },
  balanced: { width: 2048, frames: 3 },
  quality: { width: 4096, frames: 4 },
});
export const CLOUD_STYLE = Object.freeze({
  metadataTtlMs: 900000, retryMs: 120000, timeoutMs: 60000,
  requestWindowMs: 900000, requestsPerWindow: 24,
  frameDurationMs: 2400, fadeMs: 650,
  // A brightness transfer of the provider's IR visualization, NOT a cloud mask
  // or calibrated temperature retrieval. Warm low clouds can be missed; cold
  // terrain/snow can remain visible. Do not interpret alpha as cloud fraction.
  blackPoint: 85, whitePoint: 255, gamma: 1.05,
});
export function cloudBudget(quality) { return CLOUD_PROFILES[quality] || CLOUD_PROFILES.balanced; }
