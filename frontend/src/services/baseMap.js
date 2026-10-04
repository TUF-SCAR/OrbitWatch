import { SceneMode } from "cesium";

// Provider creation can await remote metadata. Keep the previous map until a
// replacement exists, and prevent late responses from reversing a newer choice.
export async function applyBaseMap(viewer, googleTiles, googleReady, effectiveMap, request, labels, factories, onStatus = () => {}, timeoutMs = 8000) {
  if (!viewer || viewer.isDestroyed()) return;
  const requestId = ++request.current;
  request.removeError?.();
  request.removeError = null;
  const current = () => requestId === request.current && !viewer.isDestroyed();
  const wantsGoogle = effectiveMap === "google" && viewer.scene.mode !== SceneMode.SCENE2D && Boolean(googleTiles);
  if (googleTiles) {
    googleTiles.show = wantsGoogle;
    if (!wantsGoogle) googleTiles.trimLoadedTiles?.();
  }
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.dynamicAtmosphereLighting = true;
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
  if (wantsGoogle && googleReady) {
    request.activeMap = "google";
    viewer.scene.globe.show = false;
    viewer.imageryLayers.removeAll(true);
    onStatus(null);
    viewer.scene.requestRender();
    return;
  }
  viewer.scene.globe.show = true;
  const rasterMap = effectiveMap === "google" ? "esri" : effectiveMap;
  let provider, fallback = false, timer;
  try {
    provider = await Promise.race([
      Promise.resolve().then(() => factories[rasterMap]?.(labels)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Map metadata timeout")), timeoutMs); }),
    ]);
  } catch { /* Report the actual fallback after it has been installed. */ }
  finally { clearTimeout(timer); }
  if (!current()) return;
  if (!provider) {
    fallback = true;
    try { provider = await factories.esri(); } catch { /* Leave previous imagery visible. */ }
  }
  if (!current()) return;
  if (!provider) {
    onStatus("Map imagery unavailable. Choose another provider to retry.");
    viewer.scene.requestRender();
    return;
  }
  viewer.imageryLayers.removeAll(true);
  viewer.imageryLayers.addImageryProvider(provider);
  request.activeMap = fallback ? "esri" : rasterMap;
  onStatus(fallback ? "Selected imagery unavailable. Esri satellite fallback is active." : effectiveMap === "google" ? "Esri satellite is active while Google detail is unavailable." : null);
  let reported = false;
  request.removeError = provider.errorEvent?.addEventListener(() => {
    if (!current() || reported) return;
    reported = true;
    onStatus("Some map tiles could not load. Cached imagery remains; choose another map to retry.");
  });
  viewer.scene.requestRender();
}
