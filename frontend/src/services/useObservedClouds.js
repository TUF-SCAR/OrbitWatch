import { useEffect, useRef, useState } from 'react';
import { cloudBudget } from './cloudConfig.js';
import { createCloudImageryService } from './cloudImagery.js';

export function useObservedClouds(active,quality) {
 const service=useRef(null),retained=useRef(null);
 const [frame,setFrame]=useState(null),[status,setStatus]=useState('idle'),[error,setError]=useState('');
 const [revision,setRevision]=useState(0),[hidden,setHidden]=useState(document.hidden);
 const [diagnostics,setDiagnostics]=useState({}),[clock,setClock]=useState(Date.now);
 useEffect(()=>{
  service.current=createCloudImageryService();
  const visibility=()=>setHidden(document.hidden);document.addEventListener('visibilitychange',visibility);
  return()=>{document.removeEventListener('visibilitychange',visibility);service.current.destroy();};
 },[]);
 useEffect(()=>{
  if(!active||hidden)return;
  const controller=new AbortController();let timer;
  async function check(){
   let delay=600000;const now=Date.now();setClock(now);
   if(retained.current&&now-Date.parse(retained.current.time)>43200000){retained.current=null;setFrame(null);}
   setStatus(retained.current?'updating':'loading');setError('');
   try {
    const owner=service.current,budget=cloudBudget(quality),metadata=await owner.current(budget,controller.signal);
    const stamp=Date.parse(metadata.observation_time),expires=Date.parse(metadata.expires_at),current=Date.now();
    if(!/^[a-f0-9]{64}$/.test(metadata.version)||!Number.isFinite(stamp)||!Number.isFinite(expires)||stamp>current||expires!==stamp+43200000||expires<=current||metadata.width!==budget.width||metadata.height!==budget.width/2)throw Error('No acceptable recent observation is available.');
    const next=await owner.frame(metadata.observation_time,budget,controller.signal,metadata);
    if(controller.signal.aborted)return;
    retained.current=next;setFrame(next);setStatus(metadata.stale?'stale':'ready');
   }catch(e){if(controller.signal.aborted)return;setError(e.message||'Observed imagery unavailable');setStatus(retained.current?'stale':'unavailable');delay=Math.max(30000,(service.current.diagnostics().retryAt||Date.now()+60000)-Date.now());}
   setDiagnostics(service.current.diagnostics());
   timer=setTimeout(check,Math.min(600000,delay));
  }
  // Effects never replace a verified image until the new JPEG decodes.
  void check();
  const expiry=setInterval(()=>{setClock(Date.now());if(retained.current&&Date.now()-Date.parse(retained.current.time)>43200000){retained.current=null;setFrame(null);setStatus('unavailable');}},30000);
  return()=>{controller.abort();clearTimeout(timer);clearInterval(expiry);};
 },[active,quality,hidden,revision]);
 return {service,frame,status,error,diagnostics,clock,
  refresh(){setRevision(value=>value+1);},
  reportError(message,previous){const usable=previous&&Date.now()-Date.parse(previous.time)<=43200000?previous:null;retained.current=usable;setFrame(usable);setStatus(usable?'stale':'unavailable');setError(`Cloud display unavailable: ${message}`);},
 };
}
