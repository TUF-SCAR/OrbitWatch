import { useEffect, useRef, useState } from 'react';
import { fetchWeatherFields } from '../services/orbitwatchApi.js';
import { weatherFreshness } from '../services/temperatureGrid.js';
import { createWeatherPoller } from '../services/weatherPolling.js';

export function useLiveWeather(active,refreshNonce) {
  const [result,setResult]=useState({field:null,error:null,availability:null,fieldProvided:false}),[clock,setClock]=useState(Date.now);
  const gate=useRef({notBefore:0});
  useEffect(()=>{
    if(!active)return;
    const poller=createWeatherPoller({fetchField:fetchWeatherFields,gate:gate.current,
      onResult({field,availability}) {
        setResult(previous=>({field:field||previous.field,error:null,availability,fieldProvided:!!field}));setClock(Date.now());
      },
      onError(error,availability) {
        setResult(previous=>({...previous,error,availability,fieldProvided:false}));setClock(Date.now());
      }});
    poller.start();const clockTimer=window.setInterval(()=>setClock(Date.now()),30000);
    return()=>{poller.stop();window.clearInterval(clockTimer);};
  },[active,refreshNonce]);
  const freshness=weatherFreshness(result.field,clock);
  const field=freshness==='unavailable'?null:result.field;
  const state=field?(!result.fieldProvided?'stale':freshness):result.availability?.state||'preparing';
  return {...result,field,state,clock};
}
