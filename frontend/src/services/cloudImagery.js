import { CLOUD_STYLE } from './cloudConfig.js';
import { fetchInfraredMetadata, fetchInfraredImage } from './orbitwatchApi.js';
const abort = () => new DOMException('Cancelled', 'AbortError');
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

// Browser memory only. OrbitWatch owns all source acquisition, leases and quotas.
export function createCloudImageryService({metadata=fetchInfraredMetadata,image=fetchInfraredImage,
 decode=decodeFrame,revoke=url=>URL.revokeObjectURL(url),now=Date.now}={}) {
 let closed=false,requests=0,hits=0,retryAt=0;
 const cache=new Map(),pending=new Map();
 function dispose(entry){if(!entry.cached&&!entry.refs&&!entry.revoked){entry.revoked=true;revoke(entry.frame.url);}}
 function release(entry){entry.refs=Math.max(0,entry.refs-1);dispose(entry);}
 function trim(region){const entries=[...cache].filter(([,entry])=>Boolean(entry.frame.bounds)===region);while(entries.length>2){const [key,entry]=entries.shift();cache.delete(key);entry.cached=false;dispose(entry);}}
 return {
  async current(budget,signal){if(closed||signal.aborted)throw abort();requests++;return metadata(budget.width,signal);},
  async frame(time,budget,signal,meta=null){
   if(closed||signal.aborted)throw abort();
   const height=budget.height||budget.width/2,bounds=budget.bounds;
   const key=meta?.version||`${time}:${budget.width}:${bounds||'global'}`;
   if(cache.has(key)){hits++;return cache.get(key).frame;}
   if(now()<retryAt)throw Error('Observed imagery is cooling down.');
   if(pending.size)throw Error('Another infrared image is preparing.');
   const controller=new AbortController();pending.set(key,controller);
   let url;
   try {
    const query=new URLSearchParams({time,width:String(budget.width),...(bounds?{bbox:bounds.join(','),height:String(height)}:{})});
    requests++;const result=await image(`/api/weather/infrared/frame?${query}`,AbortSignal.any([signal,controller.signal]));
    url=await decode(result.blob,budget.width,signal,height);
    if(closed||signal.aborted)throw abort();
    const entry={cached:true,refs:0,revoked:false};
    const frame={id:key,url,time,width:budget.width,height,bounds,retrievedAt:result.retrievedAt||meta?.retrieved_at||null,metadata:meta,
     retain(){entry.refs++;},release(){release(entry);}};
    entry.frame=frame;cache.set(key,entry);trim(Boolean(bounds));return frame;
   }catch(error){if(url)revoke(url);if(!signal.aborted&&!closed)retryAt=now()+1000*(error.retryAfterSeconds||60);throw error;}
   finally{pending.delete(key);}
  },
  diagnostics:()=>({requests,hits,cachedFrames:cache.size,pending:pending.size,retryAt}),
  destroy(){closed=true;pending.forEach(c=>c.abort());cache.forEach(entry=>{entry.cached=false;dispose(entry);});cache.clear();},
 };
}
