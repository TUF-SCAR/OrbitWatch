import { SingleTileImageryProvider, UrlTemplateImageryProvider, WebMercatorTilingScheme } from "cesium";

export const GIBS_ROOT="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
export const GIBS_CAPABILITIES=`${GIBS_ROOT}/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities`;
export const HISTORICAL_LAYER="MODIS_Terra_CorrectedReflectance_TrueColor";
export const REFERENCE_LAYER="BlueMarble_ShadedRelief_Bathymetry";
const NASA_CREDIT="NASA EOSDIS GIBS / MODIS Terra";
const day=value=>new Date(value).toISOString().slice(0,10);
const children=(element,name)=>Array.from(element.children).filter(e=>e.localName===name);
const childText=(element,name)=>children(element,name)[0]?.textContent?.trim();

export function parseGibsCapabilities(xml) {
  const doc=new DOMParser().parseFromString(xml,"application/xml");
  if(doc.getElementsByTagName("parsererror").length) throw new Error("Invalid NASA metadata");
  const layer=Array.from(doc.getElementsByTagNameNS("*","Layer")).find(e=>childText(e,"Identifier")===HISTORICAL_LAYER);
  if(!layer) throw new Error("NASA product missing");
  const link=children(layer,"TileMatrixSetLink")[0], matrix=childText(link,"TileMatrixSet");
  const set=Array.from(doc.getElementsByTagNameNS("*","TileMatrixSet")).find(e=>childText(e,"Identifier")===matrix);
  const levels=children(set,"TileMatrix");
  if(!levels.length || levels.some((e,i)=>childText(e,"Identifier")!==String(i) || childText(e,"TileWidth")!=="256" || childText(e,"TileHeight")!=="256") || !matrix.startsWith("GoogleMapsCompatible")) throw new Error("Unsupported NASA tile matrix");
  if(childText(layer,"Format")!=="image/jpeg") throw new Error("Unsupported NASA tile format");
  const dimension=children(layer,"Dimension").find(e=>childText(e,"Identifier")==="Time");
  const times=children(dimension,"Value").map(e=>e.textContent.trim());
  if(!times.length) throw new Error("NASA temporal coverage missing");
  return {identifier:HISTORICAL_LAYER,format:"image/jpeg",matrix,maximumLevel:levels.length-1,times,defaultDate:childText(dimension,"Default")};
}

export function dateInGibsCoverage(date, times) {
  return times.some(value=>{
    const [start,end,period]=value.split("/");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)) return false;
    return end ? period === "P1D" && date>=start && date<=end : date===start;
  });
}

export function nasaImageryPlan(selectedTime, metadata, now=new Date()) {
  const selectedDate=day(selectedTime), future=new Date(selectedTime).getTime()>now.getTime();
  if(future) return {kind:"reference",selectedDate,observationDate:null,message:"Future date · fixed NASA Blue Marble reference imagery; no future observations."};
  if(!metadata) return {kind:"reference",selectedDate,observationDate:null,message:"NASA archive coverage could not be verified · fixed reference imagery."};
  if(!dateInGibsCoverage(selectedDate,metadata.times)) return {kind:"reference",selectedDate,observationDate:null,message:`No MODIS Terra imagery advertised for ${selectedDate} · fixed NASA reference imagery.`};
  return {kind:"historical",selectedDate,observationDate:selectedDate,message:`NASA MODIS Terra True Color · observation day ${selectedDate} (UTC). Daily observation swaths, with cloud/coverage gaps; not an exact hour/minute snapshot.`};
}

export function nasaReferenceProvider() {
  return new UrlTemplateImageryProvider({url:`${GIBS_ROOT}/${REFERENCE_LAYER}/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,maximumLevel:8,tilingScheme:new WebMercatorTilingScheme(),credit:"NASA EOSDIS GIBS / Blue Marble · fixed reference composite"});
}

export function localEarthReferenceProvider() {
  // Existing credited NASA/JPL/USGS reference asset; no new/fake dated imagery.
  return SingleTileImageryProvider.fromUrl("/textures/planets/earth.jpg",{credit:"NASA/JPL/USGS · static reference Earth texture (undated; not selected-date imagery)"});
}

export function createNasaImageryService({fetchMetadata=async signal=>{
  const response=await fetch(GIBS_CAPABILITIES,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});
  if(!response.ok) throw new Error("NASA metadata unavailable");
  return parseGibsCapabilities(await response.text());
},now=()=>new Date(),reference=nasaReferenceProvider,history=metadata=>new UrlTemplateImageryProvider({
  url:`${GIBS_ROOT}/${metadata.identifier}/default/${metadata.observationDate}/${metadata.matrix}/{z}/{y}/{x}.jpeg`,
  maximumLevel:metadata.maximumLevel,tilingScheme:new WebMercatorTilingScheme(),credit:NASA_CREDIT,
})}={}) {
  let metadata,checkedAt=0;
  return {
    async create(selectedTime,signal) {
      const current=now();
      if(new Date(selectedTime)<=current && (!metadata || current.getTime()-checkedAt>3600000)) {
        try {metadata=await fetchMetadata(signal);checkedAt=current.getTime();}
        catch(error) {if(signal.aborted) throw error;}
      }
      if(signal.aborted) throw new DOMException("Cancelled","AbortError");
      const plan=nasaImageryPlan(selectedTime,metadata,current);
      return {provider:plan.kind==="historical" ? history({...metadata,...plan}) : reference(),details:plan};
    },
  };
}
