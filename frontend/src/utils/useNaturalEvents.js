import { useEffect, useState,useRef } from 'react';
import { fetchNaturalEvents,fetchNaturalEventBoundary } from '../services/orbitwatchApi.js';

export function useNaturalEvents(active){
  const [result,setResult]=useState({events:[],providers:{},state:'preparing'});
  const boundaryController=useRef(null);
  const [boundaryStatus,setBoundaryStatus]=useState(null);
  useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();let timer;
    async function load(){
      let delay=60000;
      try{
        const value=await fetchNaturalEvents(controller.signal);if(controller.signal.aborted)return;
        if(!Array.isArray(value?.events)||!value.providers)throw Error('Invalid event response');
        setResult(previous=>({...value,events:value.events.map(e=>{
          const prior=previous.events.find(p=>p.id===e.id&&p.source_episode_id===e.source_episode_id);
          return prior?.boundaries&&Date.now()-Date.parse(prior.boundary_retrieved_at)<3600000?{...e,boundaries:prior.boundaries,boundary_retrieved_at:prior.boundary_retrieved_at}:e;
        })}));
        delay=value.state==='preparing'||Object.values(value.providers).some(p=>p.state==='preparing'||p.state==='refreshing')?3000:
          Math.max(30000,Math.min(300000,...Object.values(value.providers).map(p=>p.retry_after_seconds*1000)));
      }catch(error){if(controller.signal.aborted)return;setResult(previous=>({...previous,state:'offline',error:error.message,
        events:previous.events.filter(e=>Date.now()-Date.parse(e.retrieved_at)<=(e.provider==='ibtracs'?7:1)*86400000).map(e=>({...e,data_state:'stale'}))}));}
      timer=window.setTimeout(load,delay);
    }
    load();return()=>{controller.abort();boundaryController.current?.abort();window.clearTimeout(timer);};
  },[active]);
  async function loadBoundary(id){
    if(!active)return;
    boundaryController.current?.abort();const controller=new AbortController();boundaryController.current=controller;
    setBoundaryStatus({id,state:'loading'});
    try{
      const response=await fetchNaturalEventBoundary(id,controller.signal);
      if(controller.signal.aborted)return;
      if(response.event_id!==id||!Array.isArray(response.boundaries))throw Error('Invalid source geometry');
      setResult(previous=>({...previous,events:previous.events.map(e=>e.id===id?{...e,boundaries:response.boundaries,boundary_retrieved_at:response.retrieved_at}:e)}));
      setBoundaryStatus({id,state:'available',message:response.boundaries.length?'Source boundaries loaded. Their role is not a verified current danger area.':'No validated polygon boundaries supplied.'});
    }catch{if(!controller.signal.aborted)setBoundaryStatus({id,state:'unavailable',message:'Official geometry unavailable or provider cooldown active. No boundary was inferred.'});}
  }
  return {...result,loadBoundary,boundaryStatus};
}
