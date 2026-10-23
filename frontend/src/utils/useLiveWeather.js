import { useEffect, useState } from 'react';
import { fetchTemperatureField } from '../services/orbitwatchApi.js';
import { validateTemperatureField, weatherFreshness } from '../services/temperatureGrid.js';

export function useLiveWeather(active,refreshNonce) {
  const [result,setResult]=useState({field:null,error:null}),[clock,setClock]=useState(Date.now);
  useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();let timer;
    async function load() {
      await Promise.resolve();if(controller.signal.aborted)return;setClock(Date.now());
      let delay=600000;
      try {
        const field=validateTemperatureField(await fetchTemperatureField(controller.signal));
        if(controller.signal.aborted)return;
        setResult({field,error:null});setClock(Date.now());if(field.refresh_pending)delay=30000;
      } catch(error) {if(controller.signal.aborted)return;setResult(value=>({...value,error}));delay=30000;}
      timer=window.setTimeout(load,delay);
    }
    load();const clockTimer=window.setInterval(()=>setClock(Date.now()),30000);
    return()=>{controller.abort();window.clearTimeout(timer);window.clearInterval(clockTimer);};
  },[active,refreshNonce]);
  const state=weatherFreshness(result.field,clock);
  return {...result,field:state==='unavailable'?null:result.field,state:result.error&&state==='available'?'stale':state,clock};
}
