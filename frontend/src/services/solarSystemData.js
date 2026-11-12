import {fetchSmallBodyElements} from './orbitwatchApi.js';
import {ALL_CELESTIAL_IDS} from '../data/celestialBodies.js';
const IDS=new Set(['ceres','pluto','eris','haumea','makemake','vesta','pallas','hygiea','eros','bennu','apophis','psyche']);
export function validateSmallBodyRecord(record){
  if(!IDS.has(record?.body_id)||!ALL_CELESTIAL_IDS.includes(record.body_id)||!['NASA/JPL SBDB','NASA/JPL Horizons'].includes(record.source)||!(record.source==='NASA/JPL SBDB'?record.api_version==='1.3':['1.2','1.3'].includes(record.api_version))||record.time_scale!=='TDB'||record.frame!=='IAU76/80 ecliptic J2000'||record.equinox!=='J2000')throw Error('Unsupported shared orbital reference');
  if(['a','e','i','om','w','ma','n','epoch_tdb','valid_from_tdb','valid_until_tdb','retrieved_at','checked_at'].some(key=>!Number.isFinite(record[key]))||record.a<=0||record.a>=200||record.e<0||record.e>=1||record.i<0||record.i>180||record.n<=0||record.valid_from_tdb>=record.valid_until_tdb||!record.solution_id||!/^\d{7,10}$/.test(record.spk_id))throw Error('Invalid compact orbital record');
  if(!['fresh','cached','stale','unavailable'].includes(record.state))throw Error('Unknown orbital availability');
  return record;
}
export function createSmallBodyStore({fetchRecords=fetchSmallBodyElements,now=Date.now,schedule=setTimeout,cancel=clearTimeout}={}){
  let state={items:[],objectStatus:{},revision:0,status:'idle'},controller=null,timer=null,nextAt=0,failures=0;
  const listeners=new Set();let owners=0;
  const publish=patch=>{state={...state,...patch};for(const listener of listeners)listener();};
  async function load(owner){
    if(owner.signal.aborted||controller!==owner)return;
    if(now()<nextAt){timer=schedule(()=>load(owner),nextAt-now());return;}
    try{
      const payload=await fetchRecords(owner.signal);
      if(owner.signal.aborted||controller!==owner)return;
      if(!Array.isArray(payload.items)||payload.items.length>IDS.size)throw Error('Unbounded small-body payload');
      const seen=new Set(),items=[];
      for(const record of payload.items){try{validateSmallBodyRecord(record);if(seen.has(record.body_id))throw Error('Duplicate reference');seen.add(record.body_id);items.push(record);}catch{/* Isolate malformed optional objects, preserve the catalogue. */}}
      // An empty/partial refresh never erases older scientifically usable records.
      const merged=new Map(state.items.map(record=>[record.body_id,record]));for(const record of items)merged.set(record.body_id,record);
      failures=0;publish({items:[...merged.values()],objectStatus:payload.object_status||{},revision:state.revision+1,status:items.length?'cached':'unavailable'});
      nextAt=now()+(payload.refresh_due?Math.max(5000,Math.min(86400000,(payload.retry_after_seconds||10)*1000)):900000);
    }catch(error){
      if(owner.signal.aborted||controller!==owner)return;
      failures=Math.min(failures+1,6);nextAt=now()+Math.max((error.retryAfterSeconds||0)*1000,Math.min(3600000,60000*2**(failures-1)));
      publish({items:state.items.map(record=>({...record,state:record.state==='unavailable'?'unavailable':'stale'})),status:state.items.length?'stale':'unavailable'});
    }
    if(!owner.signal.aborted&&owners)timer=schedule(()=>load(owner),Math.max(1000,nextAt-now()));
  }
  return {
    snapshot:()=>state,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    acquire(listener){owners++;listeners.add(listener);if(!controller){controller=new AbortController();load(controller);}let released=false;return()=>{if(released)return;released=true;owners--;listeners.delete(listener);if(!owners){controller?.abort();controller=null;cancel(timer);timer=null;}};},
  };
}
export const smallBodyStore=createSmallBodyStore();
// Compatibility export now uses OrbitWatch only; no browser SBDB integration.
export async function loadSmallBodyElements(signal){const payload=await fetchSmallBodyElements(signal);return payload.items.map(validateSmallBodyRecord);}
