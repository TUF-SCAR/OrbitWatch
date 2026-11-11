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
export async function validateCloudJpeg(blob,width,height){
  const bytes=new Uint8Array(await blob.slice(0,65536).arrayBuffer());
  if(bytes[0]!==255||bytes[1]!==216)throw Error('Invalid cloud JPEG');
  let offset=2;
  while(offset+4<bytes.length){
    if(bytes[offset++]!==255)break;
    while(bytes[offset]===255)offset++;
    const marker=bytes[offset++],size=bytes[offset]*256+bytes[offset+1];
    if(size<2)break;
    if([192,193,194].includes(marker)){
      if(size<8||bytes[offset+2]!==8||bytes[offset+3]*256+bytes[offset+4]!==height||bytes[offset+5]*256+bytes[offset+6]!==width)throw Error('Unexpected cloud image dimensions');
      return;
    }
    offset+=size;
  }
  throw Error('Missing cloud JPEG frame');
}
async function decodeFrame(blob, width, signal, height=width/2) {
  // Reject oversized encoded dimensions before allocating decompressed pixels.
  await validateCloudJpeg(blob,width,height);
  const image=await createImageBitmap(blob);
  let canvas;
  try {
    if(signal.aborted)throw abort();
    if(image.width!==width||image.height!==height)throw Error('Unexpected cloud image dimensions');
    canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
    const pixels=context.getImageData(0,0,width,height);emphasizeInfrared(pixels.data);context.putImageData(pixels,0,0);
    const result=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    canvas.width=canvas.height=1;
    if(!result)throw Error('Cloud image conversion failed');
    if(signal.aborted)throw abort();
    return URL.createObjectURL(result);
  } finally { image.close();if(canvas)canvas.width=canvas.height=1; }
}

// Per Live application session: serial fetches, deduplicated metadata, bounded
// blob cache, provider-wide backoff. No forecast API or database involvement.
export function createCloudImageryService({fetcher=fetch,now=Date.now,parse=parseCloudCapabilities,
  decode=decodeFrame,revoke=url=>URL.revokeObjectURL(url)}={}) {
  let values=null,checkedAt=0,retryAt=0,closed=false,requests=0,hits=0,queue=Promise.resolve();
  const cache=new Map(),regions=new Map(),pending=new Map(),controllers=new Set(),attempts=[];
  // Cancellation belongs to each subscriber, not the first view to request it.
  function shared(key,signal,work) {
    let job=pending.get(key);
    if(job?.controller.signal.aborted){pending.delete(key);job=null;}
    if(!job){
      if(pending.size>=8)return Promise.reject(Error('Cloud request queue full'));
      job={controller:new AbortController(),users:0};pending.set(key,job);
      job.promise=queue.then(()=>work(job.controller.signal)).finally(()=>{if(pending.get(key)===job)pending.delete(key);});
      queue=job.promise.then(()=>{},()=>{});
    }
    job.users++;
    return new Promise((resolve,reject)=>{
      let done=false;
      const finish=(fn,value)=>{if(done)return;done=true;signal.removeEventListener('abort',cancel);if(--job.users===0)job.controller.abort();fn(value);};
      const cancel=()=>finish(reject,abort());
      signal.addEventListener('abort',cancel,{once:true});
      job.promise.then(value=>finish(resolve,value),error=>finish(reject,error));
      if(signal.aborted)cancel();
    });
  }
  async function request(url, signal, image=false) {
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
      const limit=image?16000000:1000000;
      if(image&&!response.headers.get('Content-Type')?.startsWith('image/jpeg'))throw Error('Cloud image unavailable');
      if(Number(response.headers.get('Content-Length'))>limit)throw Error('Cloud response exceeds size limit');
      let payload;
      if(response.body?.getReader){
        const reader=response.body.getReader(),parts=[];let size=0;
        try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('Cloud response exceeds size limit');parts.push(value);}}
        finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
        const blob=new Blob(parts,{type:image?'image/jpeg':'text/xml'});payload=image?blob:await blob.text();
      } else {
        payload=image?await response.blob():await response.text();
        if((image?payload.size:new TextEncoder().encode(payload).length)>limit)throw Error('Cloud response exceeds size limit');
      }
      if(signal.aborted||controller.signal.aborted)throw abort();
      return payload;
    } catch(error) {if(!signal.aborted&&!controller.signal.aborted)retryAt=Math.max(retryAt,now()+CLOUD_STYLE.retryMs);throw error;}
    finally {controllers.delete(controller);}
  }
  return {
    async slots(count,signal) {
      if(closed||signal.aborted)throw abort();
      if(values&&now()-checkedAt<CLOUD_STYLE.metadataTtlMs)return cloudSlots(values,count,now());
      try {await shared('metadata',signal,async ownSignal=>{
        values=parse(await request(`${CLOUD_SOURCE.url}?service=WMS&version=1.3.0&request=GetCapabilities`,ownSignal));checkedAt=now();
      });} catch(error){if(!signal.aborted)retryAt=Math.max(retryAt,now()+CLOUD_STYLE.retryMs);if(!values||signal.aborted)throw error;}
      return cloudSlots(values,count,now());
    },
    async frame(time,budget,signal) {
      if(closed||signal.aborted)throw abort();
      if(!values||!cloudSlots(values,Math.max(4,budget.frames),now()).includes(time))throw Error('Cloud time not advertised');
      const storage=budget.bounds?regions:cache,height=budget.height||budget.width/2;
      if(!Number.isFinite(budget.width)||budget.width<1||budget.width>4096||!Number.isFinite(height)||height<1||height>2048||!Number.isInteger(budget.frames)||budget.frames<1||budget.frames>4)throw Error('Invalid cloud frame budget');
      if(budget.bounds&&(budget.bounds.length!==4||!budget.bounds.every(Number.isFinite)||budget.bounds[0]<-180||budget.bounds[2]>180||budget.bounds[1]<-90||budget.bounds[3]>90||budget.bounds[0]>=budget.bounds[2]||budget.bounds[1]>=budget.bounds[3]))throw Error('Invalid cloud bounds');
      const key=`${budget.width}x${height}:${time}${budget.bounds?':'+budget.bounds.join(','):''}`;
      if(storage.has(key)){hits++;return storage.get(key);}
      return shared(key,signal,async ownSignal=>{
        const blob=await request(cloudMapUrl(time,budget.width,budget.bounds,height),ownSignal,true);
        const url=await decode(blob,budget.width,ownSignal,height);
        if(closed||ownSignal.aborted){revoke(url);throw abort();}
        const frame={id:key,url,time,width:budget.width,height,bounds:budget.bounds};storage.set(key,frame);
        while(storage.size>budget.frames){const [old,entry]=storage.entries().next().value;revoke(entry.url);storage.delete(old);}
        return frame;
      }).catch(error=>{if(!signal.aborted)retryAt=Math.max(retryAt,now()+CLOUD_STYLE.retryMs);throw error;});
    },
    diagnostics:()=>({requests,hits,cachedFrames:cache.size,regionalFrames:regions.size,pending:pending.size,retryAt}),
    destroy(){closed=true;pending.forEach(job=>job.controller.abort());controllers.forEach(c=>c.abort());cache.forEach(f=>revoke(f.url));cache.clear();regions.forEach(f=>revoke(f.url));regions.clear();},
  };
}
