// Display budgets, not additional scientific resolution. One backend image per version.
export const CLOUD_SOURCE = Object.freeze({
  layer: 'mumi:worldcloudmap_ir108',
  credit: 'EUMETSAT / NOAA / JMA · geostationary infrared composite',
  information: 'https://view.eumetsat.int/productviewer/productDetails/mumi%3Aworldcloudmap_ir108',
});
export const CLOUD_PROFILES = Object.freeze({
  performance: { width: 1024 },
  balanced: { width: 2048 },
  quality: { width: 2048 },
});
export const CLOUD_STYLE = Object.freeze({
  fadeMs: 650,
  // A brightness transfer of the provider's IR visualization, NOT a cloud mask
  // or calibrated temperature retrieval. Warm low clouds can be missed; cold
  // terrain/snow can remain visible. Do not interpret alpha as cloud fraction.
  blackPoint: 85, whitePoint: 255, gamma: 1.05,
});
export function cloudBudget(quality) {
  if(typeof matchMedia==='function'&&matchMedia('(max-width: 600px), (max-width: 1000px) and (max-height: 600px) and (pointer: coarse)').matches)return CLOUD_PROFILES.performance;
  return CLOUD_PROFILES[quality] || CLOUD_PROFILES.balanced;
}
