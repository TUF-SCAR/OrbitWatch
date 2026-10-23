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
export async function applyBaseMap(viewer, googleTiles, googleReady, effectiveMap, request, labels, factories, onStatus=()=>{}, timeoutMs=8000, contextKey="") {
  if(!viewer || viewer.isDestroyed()) return;
  const key=`${effectiveMap}:${labels}:${contextKey}:${effectiveMap==="google" && googleReady}`;
  const represented=effectiveMap==="google" ? Boolean(googleTiles && googleReady) : viewer.imageryLayers.length>0;
  if(request.activeKey===key && request.activeMap===effectiveMap && represented) return;
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
  let timer, details={}, failed=false, failure;
  async function prepare(map) {
    const value=await factories[map]?.(labels,{signal:controller.signal});
    if(!value) throw Object.assign(new Error("Provider is unconfigured"),{unconfigured:true});
    const provider=value.provider || value;
    // Validate an actual low-resolution tile before replacing visible imagery.
    if(typeof provider.requestImage==="function") {
      const tileRequest=new Request({throttle:false,type:RequestType.IMAGERY});
      const cancel=()=>tileRequest.cancel();controller.signal.addEventListener("abort",cancel,{once:true});
      try {
        const image=await provider.requestImage(0,0,0,tileRequest);
        if(!image) throw new Error("Provider tile unavailable");
      } finally {controller.signal.removeEventListener("abort",cancel);}
    }
    return {provider,details:value.details || {}};
  }
  async function bounded(map) {
    try {return await Promise.race([prepare(map),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Map timeout")),timeoutMs);})]);}
    finally {clearTimeout(timer);}
  }
  let prepared;
  const primary=effectiveMap==="google" ? "esri" : effectiveMap;
  try {prepared=await bounded(primary);details=prepared.details;}
  catch(error) {failure=error;failed=true;}
  if(!current()) return;
  if(!prepared) {
    // Historical failures must not substitute current satellite imagery for a
    // dated observation. NASA reference, then credited local Earth reference.
    const fallbacks=effectiveMap==="nasa-time" ? ["nasa-reference","local-reference"] : effectiveMap==="nasa-reference" ? ["local-reference"] : ["esri","local-reference"];
    for(const map of fallbacks) {
      try {prepared=await bounded(map);prepared.fallbackMap=map;break;} catch { /* Try the next explicit reference. */ }
      if(!current()) return;
    }
  }
  if(!current()) return;
  if(!prepared) {status(failure?.unconfigured ? "unconfigured" : "unavailable","Map imagery unavailable. Previous imagery retained; choose another provider to retry.");viewer.scene.requestRender();return;}
  const {provider}=prepared;
  const old=Array.from({length:viewer.imageryLayers.length},(_,i)=>viewer.imageryLayers.get(i));
  viewer.imageryLayers.addImageryProvider(provider);
  old.forEach(layer=>viewer.imageryLayers.remove(layer,true));
  request.activeMap=prepared.fallbackMap || primary;
  setEarthMapVisibility(viewer,googleTiles,true,request.activeMap,wantsGoogle && !googleReady);
  if(googleTiles && !googleTiles.show) googleTiles.trimLoadedTiles?.();
  request.activeKey=failed ? null : key;
  const googleFallback=effectiveMap==="google";
  if(failed && ["nasa-time","nasa-reference"].includes(effectiveMap)) details={kind:"reference",observationDate:null,message:"NASA imagery unavailable · fixed reference imagery (not the selected observation date)."};
  const message=failed ? `${failure?.unconfigured ? "Selected provider is unconfigured" : providerErrorSummary(failure)}. ${request.activeMap==="local-reference" ? "Static NASA/JPL/USGS Earth reference" : effectiveMap==="nasa-time" ? "Fixed NASA reference imagery" : "Esri satellite fallback"} is active.${details.message ? ` ${details.message}` : ""}`
    : googleFallback ? `Esri satellite is active while Google detail is unavailable${request.googleError ? ` (${request.googleError})` : " / loading"}.` : details.message || null;
  status(failed ? failure?.unconfigured ? "unconfigured" : "unavailable" : googleFallback ? request.googleError ? "unavailable" : "loading" : "available",message,details);
  let reported=false;
  request.removeError=provider.errorEvent?.addEventListener(()=>{
    if(!current() || reported) return;reported=true;
    request.activeKey=null;
    status("unavailable","Some provider tiles failed. Cached imagery remains; choose another map to retry.",details);
  });
  viewer.scene.requestRender();
}
