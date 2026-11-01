import {useEffect,useMemo,useState} from 'react';
import {fetchLocationWeather} from '../services/orbitwatchApi.js';
import {createLocationWeatherSelection,EMPTY_LOCATION_WEATHER} from '../services/locationWeatherSelection.js';
import {weatherFreshness} from '../services/temperatureGrid.js';

export function useLocationWeather(active) {
  const [state,setState]=useState(EMPTY_LOCATION_WEATHER),[clock,setClock]=useState(Date.now);
  const owner=useMemo(()=>createLocationWeatherSelection({fetchWeather:fetchLocationWeather,onChange:setState}),[]);
  useEffect(()=>{if(!active)owner.clear();return()=>owner.clear();},[active,owner]);
  useEffect(()=>{
    if(!state.selection)return;
    const timer=setInterval(()=>setClock(Date.now()),15000);
    return()=>clearInterval(timer);
  },[state.selection]);
  useEffect(()=>()=>owner.destroy(),[owner]);
  const currentClock=Math.max(clock,state.clock||0);
  const freshness=weatherFreshness(state.data,currentClock,'location');
  const visible=active?state:EMPTY_LOCATION_WEATHER;
  return {...visible,clock:currentClock,freshness,data:freshness==='unavailable'?null:visible.data,
    select:active?owner.select:()=>{},clear:owner.clear,retry:owner.retry};
}
