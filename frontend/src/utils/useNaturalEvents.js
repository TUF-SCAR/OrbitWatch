import { useEffect, useState } from 'react';
import { fetchNaturalEvents } from '../services/orbitwatchApi.js';

export function useNaturalEvents(active){
  const [result,setResult]=useState({events:[],providers:{},state:'preparing'});
  useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();let timer;
    async function load(){
      let delay=60000;
      try{
        const value=await fetchNaturalEvents(controller.signal);if(controller.signal.aborted)return;
        if(!Array.isArray(value?.events)||!value.providers)throw Error('Invalid event response');
        setResult(value);
        delay=value.state==='preparing'||Object.values(value.providers).some(p=>p.state==='preparing'||p.state==='refreshing')?3000:
          Math.max(30000,Math.min(300000,...Object.values(value.providers).map(p=>p.retry_after_seconds*1000)));
      }catch(error){if(controller.signal.aborted)return;setResult(previous=>({...previous,state:'offline',error:error.message,
        events:previous.events.filter(e=>Date.now()-Date.parse(e.retrieved_at)<=86400000).map(e=>({...e,data_state:'stale'}))}));}
      timer=window.setTimeout(load,delay);
    }
    load();return()=>{controller.abort();window.clearTimeout(timer);};
  },[active]);
  return result;
}
