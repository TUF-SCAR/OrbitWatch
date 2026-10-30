import { SingleTileImageryProvider, UrlTemplateImageryProvider, WebMercatorTilingScheme } from "cesium";

const GIBS_ROOT="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const REFERENCE_LAYER="BlueMarble_ShadedRelief_Bathymetry";

export function nasaReferenceProvider() {
  return new UrlTemplateImageryProvider({url:`${GIBS_ROOT}/${REFERENCE_LAYER}/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,maximumLevel:8,tilingScheme:new WebMercatorTilingScheme(),credit:"NASA EOSDIS GIBS / Blue Marble · fixed reference composite"});
}
export function localEarthReferenceProvider() {
  // Existing credited NASA/JPL/USGS reference asset; no new/fake dated imagery.
  return SingleTileImageryProvider.fromUrl("/textures/planets/earth.jpg",{credit:"NASA/JPL/USGS · static reference Earth texture (undated; not selected-date imagery)"});
}
