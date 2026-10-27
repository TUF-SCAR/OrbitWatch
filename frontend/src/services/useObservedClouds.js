import { useEffect, useRef, useState } from 'react';
import { cloudBudget, CLOUD_STYLE } from './cloudConfig.js';
import { createCloudImageryService } from './cloudImagery.js';

export function useObservedClouds(active,quality) {
  const service=useRef(null);
  const [frames,setFrames]=useState([]),[index,setIndex]=useState(0),[playing,setPlaying]=useState(false);
  const [status,setStatus]=useState('idle'),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [hidden,setHidden]=useState(document.hidden),[reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [diagnostics,setDiagnostics]=useState({});
  const [clock,setClock]=useState(Date.now);
  useEffect(()=>{
    service.current=createCloudImageryService();
    const visibility=()=>{setHidden(document.hidden);if(document.hidden)setPlaying(false);};
    const media=matchMedia('(prefers-reduced-motion: reduce)'),motion=()=>{setReduced(media.matches);if(media.matches)setPlaying(false);};
    document.addEventListener('visibilitychange',visibility);media.addEventListener('change',motion);
    return()=>{document.removeEventListener('visibilitychange',visibility);media.removeEventListener('change',motion);service.current.destroy();};
  },[]);
  useEffect(()=>{
    const controller=new AbortController(),signal=controller.signal,budget=cloudBudget(quality),owner=service.current;
    (async()=>{
      await Promise.resolve();
      if(signal.aborted)return;
      setPlaying(false);
      if(!active||hidden)return;
      setStatus('loading');setError('');setClock(Date.now());
      try {
        const times=await owner.slots(budget.frames,signal);
        if(!times.length)throw Error('No observed frames advertised');
        const loaded=[];
        // Show the newest verified slot first; older frames prepare serially.
        for(const time of [...times].reverse()){
          const frame=await owner.frame(time,budget,signal);if(signal.aborted)return;
          loaded.unshift(frame);setFrames([...loaded]);setIndex(loaded.length-1);setDiagnostics(owner.diagnostics());
        }
        setStatus('ready');
      } catch(e){if(!signal.aborted){setError(e.message||'Observed imagery unavailable');setStatus('unavailable');setDiagnostics(owner.diagnostics());}}
    })();
    return()=>controller.abort();
  },[active,quality,hidden,revision]);
  useEffect(()=>{
    if(!active||hidden)return;
    const timer=setInterval(()=>setClock(Date.now()),30000);
    return()=>clearInterval(timer);
  },[active,hidden]);
  useEffect(()=>{
    if(!active||hidden||reduced||!playing||frames.length<2)return;
    const timer=setInterval(()=>setIndex(value=>{
      if(value>=frames.length-1){setPlaying(false);return value;}
      return value+1;
    }),CLOUD_STYLE.frameDurationMs);
    return()=>clearInterval(timer);
  },[active,hidden,reduced,playing,frames.length]);
  return {service,frame:frames[index]||null,frames,index,status,error,playing,reduced,diagnostics,clock,
    select(value){setPlaying(false);setIndex(Number(value));},
    toggle(){if(playing){setPlaying(false);return;}if(reduced||frames.length<2)return;setIndex(0);setPlaying(true);},
    refresh(){setRevision(value=>value+1);},
    reportError(message){setPlaying(false);setFrames([]);setIndex(0);setStatus('unavailable');setError(`Cloud display unavailable: ${message}`);},
  };
}
