import { CLOUD_SOURCE, CLOUD_STYLE } from './cloudConfig.js';

const abort = () => new DOMException('Cancelled', 'AbortError');
// Expand only the last requested slots, never the entire multi-year archive.
export function cloudSlots(values, count, now = Date.now()) {
  const slots = new Set();
  for (const value of values) {
    const [start, end, period] = value.trim().split('/');
    const first = Date.parse(start), last = end ? Date.parse(end) : first;
    if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) continue;
    if (!end) { if (first <= now) slots.add(first); continue; }
    if (period !== 'PT3H') continue; // fail closed if the provider changes cadence
    const step = 10800000, top = Math.min(last, now);
    let t = first + Math.floor((top - first) / step) * step;
    for (let i = 0; i < count && t >= first; i++, t -= step) slots.add(t);
  }
  return [...slots].sort((a,b) => a-b).slice(-count).map(t => new Date(t).toISOString());
}
export function parseCloudCapabilities(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw Error('Invalid cloud metadata');
  const children = (e, name) => [...e.children].filter(c => c.localName === name);
  const layer = [...doc.getElementsByTagNameNS('*','Layer')].find(e => children(e,'Name')[0]?.textContent === CLOUD_SOURCE.layer);
  if (!layer) throw Error('Observed cloud product unavailable');
  const dimension = children(layer,'Dimension').find(e => e.getAttribute('name') === 'time');
  const values = dimension?.textContent?.trim().split(',') || [];
  if (!cloudSlots(values, 1).length) throw Error('No advertised cloud observations');
  return values;
}
export function cloudMapUrl(time, width, bounds=null, height=width/2) {
  const p = new URLSearchParams({service:'WMS',version:'1.1.1',request:'GetMap',layers:CLOUD_SOURCE.layer,
    styles:'',format:'image/jpeg',bgcolor:'0x000000',srs:'EPSG:4326',bbox:bounds?bounds.join(','):'-180,-90,180,90',
    width:String(width),height:String(height),time});
  return `${CLOUD_SOURCE.url}?${p}`;
}
export function emphasizeInfrared(pixels) {
  for (let i=0;i<pixels.length;i+=4) {
    const value=(pixels[i]+pixels[i+1]+pixels[i+2])/3;
    const t=Math.max(0,Math.min(1,(value-CLOUD_STYLE.blackPoint)/(CLOUD_STYLE.whitePoint-CLOUD_STYLE.blackPoint)));
    pixels[i+3]=Math.round(pixels[i+3]*Math.pow(t,CLOUD_STYLE.gamma));
    pixels[i]=pixels[i+1]=pixels[i+2]=Math.round(210+45*t);
  }
  return pixels;
}
async function decodeFrame(blob, width, signal, height=width/2) {
  const image=await createImageBitmap(blob);
  try {
    if(signal.aborted)throw abort();
    if(image.width!==width||image.height!==height)throw Error('Unexpected cloud image dimensions');
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
    const pixels=context.getImageData(0,0,width,height);emphasizeInfrared(pixels.data);context.putImageData(pixels,0,0);
    const result=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    canvas.width=canvas.height=1;
    if(!result)throw Error('Cloud image conversion failed');
    if(signal.aborted)throw abort();
    return URL.createObjectURL(result);
  } finally { image.close(); }
}

// Per Live application session: serial fetches, deduplicated metadata, bounded
// blob cache, provider-wide backoff. No forecast API or database involvement.
export function createCloudImageryService({fetcher=fetch,now=Date.now,parse=parseCloudCapabilities,
  decode=decodeFrame,revoke=url=>URL.revokeObjectURL(url)}={}) {
  let values=null,checkedAt=0,retryAt=0,closed=false,pendingMetadata=null,metadataSignal=null,requests=0,hits=0;
  const cache=new Map(),regions=new Map(),pending=new Map(),pendingSignals=new Map(),controllers=new Set(),attempts=[];
  async function request(url, signal) {
    if(closed||signal.aborted)throw abort();
    if(now()<retryAt)throw Error('Cloud provider cooling down');
    while(attempts.length&&attempts[0]<=now()-CLOUD_STYLE.requestWindowMs)attempts.shift();
    if(attempts.length>=CLOUD_STYLE.requestsPerWindow){retryAt=attempts[0]+CLOUD_STYLE.requestWindowMs;throw Error('Cloud request budget cooling down');}
    attempts.push(now());
    const controller=new AbortController();controllers.add(controller);requests++;
    try {
      const response=await fetcher(url,{signal:AbortSignal.any([signal,controller.signal,AbortSignal.timeout(CLOUD_STYLE.timeoutMs)]),credentials:'omit'});
      if(!response.ok){
        const header=response.headers.get('Retry-After'),seconds=Number(header);
        const delay=header?(Number.isFinite(seconds)?seconds*1000:Date.parse(header)-now()):0;
        retryAt=now()+Math.max(CLOUD_STYLE.retryMs,delay||0);throw Error(`Cloud provider HTTP ${response.status}`);
      }
      return response;
    } catch(error) {if(!signal.aborted&&!controller.signal.aborted)retryAt=Math.max(retryAt,now()+CLOUD_STYLE.retryMs);throw error;}
    finally {controllers.delete(controller);}
  }
  return {
    async slots(count,signal) {
      if(closed||signal.aborted)throw abort();
      if(values&&now()-checkedAt<CLOUD_STYLE.metadataTtlMs)return cloudSlots(values,count,now());
      if(pendingMetadata&&metadataSignal?.aborted){try{await pendingMetadata;}catch{/* cancelled older activation */}}
      if(closed||signal.aborted)throw abort();
      if(!pendingMetadata)metadataSignal=signal;
      pendingMetadata ||= (async()=>{
        const response=await request(`${CLOUD_SOURCE.url}?service=WMS&version=1.3.0&request=GetCapabilities`,signal);
        values=parse(await response.text());checkedAt=now();return values;
      })().finally(()=>{pendingMetadata=null;});
      try {await pendingMetadata;} catch(error){if(!values||signal.aborted)throw error;}
      return cloudSlots(values,count,now());
    },
    async frame(time,budget,signal) {
      if(closed||signal.aborted)throw abort();
      if(!values||!cloudSlots(values,Math.max(4,budget.frames),now()).includes(time))throw Error('Cloud time not advertised');
      const storage=budget.bounds?regions:cache,height=budget.height||budget.width/2;
      const key=`${budget.width}:${time}${budget.bounds?':'+budget.bounds.join(','):''}`;
      if(storage.has(key)){hits++;return storage.get(key);}
      if(pending.has(key)&&pendingSignals.get(key)?.aborted){try{await pending.get(key);}catch{/* finish cancelled prior view */}}
      if(closed||signal.aborted)throw abort();
      if(pending.has(key))return pending.get(key);
      pendingSignals.set(key,signal);
      const task=(async()=>{
        const response=await request(cloudMapUrl(time,budget.width,budget.bounds,height),signal);
        if(!response.headers.get('Content-Type')?.startsWith('image/jpeg'))throw Error('Cloud image unavailable');
        const url=await decode(await response.blob(),budget.width,signal,height);
        if(closed||signal.aborted){revoke(url);throw abort();}
        const frame={id:key,url,time,width:budget.width,height,bounds:budget.bounds};storage.set(key,frame);
        while(storage.size>budget.frames){const [old,entry]=storage.entries().next().value;revoke(entry.url);storage.delete(old);}
        return frame;
      })().catch(error=>{if(!signal.aborted)retryAt=Math.max(retryAt,now()+CLOUD_STYLE.retryMs);throw error;}).finally(()=>{pending.delete(key);pendingSignals.delete(key);});
      pending.set(key,task);return task;
    },
    diagnostics:()=>({requests,hits,cachedFrames:cache.size,regionalFrames:regions.size,pending:pending.size,retryAt}),
    destroy(){closed=true;controllers.forEach(c=>c.abort());cache.forEach(f=>revoke(f.url));cache.clear();regions.forEach(f=>revoke(f.url));regions.clear();},
  };
}
