import { Request, RequestType, SceneMode } from "cesium";

export function providerErrorSummary(error) {
  const code=Number(error?.statusCode || error?.status || 0);
  return code===401 || code===403 ? `HTTP ${code}: provider authorization/origin restriction` : code===429 ? "HTTP 429: provider quota/rate limit" : code ? `HTTP ${code}: provider unavailable` : "Provider/network unavailable";
}

export function setEarthMapVisibility(viewer, tiles, show, activeMap, loadingGoogle=false) {
  viewer.scene.globe.show=show && activeMap!=="google";
  if(tiles) tiles.show=show && (activeMap==="google" || loadingGoogle);
}

// One atomic map owner: old imagery survives metadata/tile validation, stale
// completions cannot apply, and outgoing error listeners/requests are released.
export function applyBaseMap(viewer, googleTiles, googleReady, effectiveMap, request, labels, factories, onStatus=()=>{}, timeoutMs=8000) {
  // Esri has no label variant or date dimension. Share pending work as well as
  // settled imagery so scene-time changes never restart the same tile request.
  const key=`${effectiveMap}:${effectiveMap==='esri' ? false : labels}:${effectiveMap==='google' && googleReady}`;
  if(request.pending?.key===key && request.pending.id===request.current) return request.pending.promise;
  const pending={key};
  pending.promise=replaceBaseMap(viewer,googleTiles,googleReady,effectiveMap,request,labels,factories,onStatus,timeoutMs,key)
    .finally(()=>{if(request.pending===pending) request.pending=null;});
  pending.id=request.current;
  request.pending=pending;
  return pending.promise;
}

async function replaceBaseMap(viewer, googleTiles, googleReady, effectiveMap, request, labels, factories, onStatus, timeoutMs, key) {
  if(!viewer || viewer.isDestroyed()) return;
  const represented=effectiveMap==="google" ? Boolean(googleTiles && googleReady) : viewer.imageryLayers.length>0;
  if(request.activeKey===key && (request.failed || represented && (request.activeMap===effectiveMap || effectiveMap==='esri' && request.activeMap==='local-reference'))) return;
  const id=++request.current;
  request.abort?.();request.removeError?.();request.removeError=null;
  const controller=new AbortController();request.abort=()=>controller.abort();
  const current=()=>id===request.current && !viewer.isDestroyed() && !controller.signal.aborted;
  request.providers ||= {};
  const status=(state,message,details={})=>{
    if(!current()) return;
    request.providers[effectiveMap]=state;
    onStatus({...details,requestedMap:effectiveMap,activeMap:request.activeMap || null,state,message,providers:{...request.providers}});
  };
  const wantsGoogle=effectiveMap==="google" && viewer.scene.mode!==SceneMode.SCENE2D && Boolean(googleTiles);
  // A pending raster switch keeps the currently rendered Google surface until
  // its replacement tile is validated; requested provider != active provider.
  setEarthMapVisibility(viewer,googleTiles,true,request.activeMap,wantsGoogle && !googleReady);
  viewer.scene.globe.enableLighting=true;
  viewer.scene.globe.dynamicAtmosphereLighting=true;
  viewer.scene.globe.dynamicAtmosphereLightingFromSun=true;
  if(wantsGoogle && googleReady) {
    request.activeMap="google";request.activeKey=key;
    viewer.scene.globe.show=false;viewer.imageryLayers.removeAll(true);
    status("available",null);viewer.scene.requestRender();return;
  }
  status("loading","Loading selected imagery; the previous map remains until the replacement is ready.");
  let details={}, failed=false, failure;
  async function prepare(map,signal) {
    const value=await factories[map]?.(labels,{signal});
    if(signal.aborted) throw new DOMException('Cancelled','AbortError');
    if(!value) throw Object.assign(new Error("Provider is unconfigured"),{unconfigured:true});
    const provider=value.provider || value;
    // Validate an actual low-resolution tile before replacing visible imagery.
    if(typeof provider.requestImage==="function") {
      const tileRequest=new Request({throttle:false,type:RequestType.IMAGERY});
      const cancel=()=>tileRequest.cancel();signal.addEventListener("abort",cancel,{once:true});
      try {
        const image=await provider.requestImage(0,0,0,tileRequest);
        if(!image) throw new Error("Provider tile unavailable");
      } finally {signal.removeEventListener("abort",cancel);}
    }
    return {provider,details:value.details || {}};
  }
  async function bounded(map) {
    const attempt=new AbortController();let timer,abort;
    const cancelled=new Promise((_,reject)=>{
      abort=()=>{attempt.abort();reject(new DOMException('Cancelled','AbortError'));};
      controller.signal.addEventListener('abort',abort,{once:true});
      if(controller.signal.aborted) abort();
    });
    try {return await Promise.race([prepare(map,attempt.signal),cancelled,new Promise((_,reject)=>{timer=setTimeout(()=>{attempt.abort();reject(new Error("Map timeout"));},timeoutMs);})]);}
    finally {clearTimeout(timer);controller.signal.removeEventListener('abort',abort);attempt.abort();}
  }
  let prepared;
  const primary=effectiveMap==="google" ? "esri" : effectiveMap;
  try {prepared=await bounded(primary);details=prepared.details;}
  catch(error) {failure=error;failed=true;}
  if(!current()) return;
  if(!prepared) {
    // Esri and NASA reference failures use only the existing credited texture.
    const fallbacks=['esri','nasa-reference'].includes(primary) ? ["local-reference"] : ["esri","local-reference"];
    for(const map of fallbacks) {
      try {prepared=await bounded(map);prepared.fallbackMap=map;break;} catch { /* Try the next explicit reference. */ }
      if(!current()) return;
    }
  }
  if(!current()) return;
  if(!prepared) {request.activeKey=key;request.failed=true;status(failure?.unconfigured ? "unconfigured" : "unavailable","Map imagery unavailable. Previous imagery retained; retry the basemap or choose another provider.");viewer.scene.requestRender();return;}
  request.failed=false;
  const {provider}=prepared;
  const old=Array.from({length:viewer.imageryLayers.length},(_,i)=>viewer.imageryLayers.get(i));
  viewer.imageryLayers.addImageryProvider(provider,0);
  old.filter(layer=>!layer.orbitwatchWeather).forEach(layer=>viewer.imageryLayers.remove(layer,true));
  request.activeMap=prepared.fallbackMap || primary;
  setEarthMapVisibility(viewer,googleTiles,true,request.activeMap,wantsGoogle && !googleReady);
  if(googleTiles && !googleTiles.show) googleTiles.trimLoadedTiles?.();
  request.activeKey=failed && effectiveMap!=='esri' ? null : key;
  const googleFallback=effectiveMap==="google";
  if(request.activeMap==='local-reference') details={kind:"reference",observationDate:null,message:"Static NASA/JPL/USGS Earth reference texture · not imagery from the selected time."};
  const message=failed ? `${failure?.unconfigured ? "Selected provider is unconfigured" : providerErrorSummary(failure)}. ${request.activeMap==="local-reference" ? "Static NASA/JPL/USGS Earth reference" : "Esri satellite fallback"} is active.${details.message ? ` ${details.message}` : ""}`
    : googleFallback ? `Esri satellite is active while Google detail is unavailable${request.googleError ? ` (${request.googleError})` : " / loading"}.` : details.message || null;
  status(failed ? failure?.unconfigured ? "unconfigured" : "unavailable" : googleFallback ? request.googleError ? "unavailable" : "loading" : "available",message,details);
  let reported=false;
  request.removeError=provider.errorEvent?.addEventListener(()=>{
    if(!current() || reported) return;reported=true;
    if(effectiveMap!=='esri') request.activeKey=null;
    status("unavailable","Some provider tiles failed. Cached imagery remains; retry the basemap or choose another map.",details);
  });
  viewer.scene.requestRender();
}
