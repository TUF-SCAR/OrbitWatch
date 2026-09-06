import { SMALL_BODY_NAMES } from "../data/solarSystemBodies.js";
const CACHE_KEY = "orbitwatch_small_body_elements_v1";
const MAX_AGE = 24 * 60 * 60 * 1000;
function numeric(map,name){ const v=map.get(name); return v == null ? null : Number(v); }
function parseOne(name,data){
  if(!data?.orbit?.elements) return null;
  const map=new Map(data.orbit.elements.map((item)=>[item.name,item.value]));
  const a=numeric(map,'a'),e=numeric(map,'e'),i=numeric(map,'i'),om=numeric(map,'om'),w=numeric(map,'w'),ma=numeric(map,'ma');
  let n=numeric(map,'n'); const per=numeric(map,'per');
  if(!Number.isFinite(n) && Number.isFinite(per) && per>0) n=360/per;
  const epoch=Number(data.orbit.epoch);
  if([a,e,i,om,w,ma,n,epoch].some((v)=>!Number.isFinite(v))) return null;
  return {name:data.object?.fullname?.trim() || data.object?.shortname || name,a,e,i,om,w,ma,n,epoch};
}
export async function loadSmallBodyElements(signal){
  try { const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'null'); if(cached && Date.now()-cached.savedAt<MAX_AGE && Array.isArray(cached.items)) return cached.items; } catch {}
  const results=await Promise.allSettled(SMALL_BODY_NAMES.map(async(name)=>{
    const url=`https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${encodeURIComponent(name)}&full-prec=true`;
    const response=await fetch(url,{signal}); if(!response.ok) throw new Error(`${name}: ${response.status}`); return parseOne(name,await response.json());
  }));
  const items=results.map((r)=>r.status==='fulfilled'?r.value:null).filter(Boolean);
  if(items.length){ try{ localStorage.setItem(CACHE_KEY,JSON.stringify({savedAt:Date.now(),items})); }catch{} }
  return items;
}
