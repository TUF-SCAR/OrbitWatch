export const WEATHER_ALTITUDE = Object.freeze({ hidden:200000, full:250000 });

// A continuous curve has no visibility toggle to oscillate at either boundary.
// Its zero slope at both ends makes small camera-height noise imperceptible.
export function weatherAltitudeAlpha(height) {
  if(!Number.isFinite(height))return 1;
  const t=Math.max(0,Math.min(1,(height-WEATHER_ALTITUDE.hidden)/(WEATHER_ALTITUDE.full-WEATHER_ALTITUDE.hidden)));
  return t*t*(3-2*t);
}

// Runs in Cesium's render cycle, without React state or weather re-creation.
// Resolve owners each frame so late-loaded layers receive the current factor.
export function mountWeatherAltitudeFade(viewer,getOwners) {
  return viewer.scene.preRender.addEventListener(()=>{
    const alpha=weatherAltitudeAlpha(viewer.camera.positionCartographic.height);
    for(const owner of getOwners())owner?.setAltitudeAlpha(alpha);
  });
}
