import { Cesium3DTileset } from "cesium";
export const GOOGLE_EARTH_ASSET=2275207;
// Cesium 1.144's convenience Google factory caches even a rejected endpoint
// promise. Public fromIonAssetId uses the same authorized Google asset/credits
// but resolves a fresh endpoint on an explicit retry/new Viewer. The caller
// uses only the Google geocoder with these tiles.
export function loadGoogleEarthTiles(options) {
  return Cesium3DTileset.fromIonAssetId(GOOGLE_EARTH_ASSET,options);
}
