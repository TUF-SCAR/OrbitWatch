import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Crosshair, Thermometer, X } from 'lucide-react';
import SpatialSurface from './SpatialSurface.jsx';
import { fetchLocationWeather } from '../services/orbitwatchApi.js';
import { TEMPERATURE_GRADIENT } from '../services/temperatureGrid.js';
import './WeatherPanel.css';

function weatherTime(value) {
  const time=new Date(value);return Number.isFinite(time.getTime())?`${time.toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false})} UTC`:'Unavailable';
}
function condition(code) {
  if(code===null||code===undefined)return 'Unavailable';
  if(code===0)return 'Clear';if(code===1)return 'Mainly clear';if(code===2)return 'Partly cloudy';if(code===3)return 'Overcast';
  if([45,48].includes(code))return 'Fog';if([51,53,55].includes(code))return 'Drizzle';if([56,57].includes(code))return 'Freezing drizzle';
  if([61,63,65].includes(code))return 'Rain';if([66,67].includes(code))return 'Freezing rain';if([71,73,75,77].includes(code))return 'Snow';
  if([80,81,82].includes(code))return 'Rain showers';if([85,86].includes(code))return 'Snow showers';if([95,96,99].includes(code))return 'Thunderstorm';return `Weather code ${code}`;
}
export function TemperatureLegend({field,state}) {
  return <aside className="weather-legend" aria-label="Temperature legend"><div><strong>2 m AIR TEMPERATURE · °C</strong><span>{state==='stale'?'CACHED · STALE':'GFS · 1°'}</span></div><i style={{background:TEMPERATURE_GRADIENT}}/><div className="weather-legend__ticks"><span>≤−60</span><span>−30</span><span>0</span><span>30</span><span>≥60</span></div><small>{field.kind==='analysis'?'Analysis':'Forecast'} valid {weatherTime(field.valid_at)} · <a href="https://nomads.ncep.noaa.gov/" target="_blank" rel="noreferrer">NOAA/NCEP</a></small></aside>;
}
export default function WeatherPanel({open,onClose,weather,enabled,onEnabled,opacity,onOpacity,compatible,onCompatibleMap,onRefresh,refreshCooling,onViewCenter}) {
  const [latitude,setLatitude]=useState(''),[longitude,setLongitude]=useState(''),[point,setPoint]=useState(null),[pointError,setPointError]=useState(''),[pointBusy,setPointBusy]=useState(false);
  const request=useRef(null),lastAttempt=useRef(0);
  useEffect(()=>{if(!open)request.current?.abort();return()=>request.current?.abort();},[open]);
  async function loadPoint(lat,lon) {
    if(Date.now()-lastAttempt.current<2000)return;
    lastAttempt.current=Date.now();request.current?.abort();const controller=new AbortController();request.current=controller;
    setPointBusy(true);setPointError('');setPoint(null);
    try {const value=await fetchLocationWeather(lat,lon,controller.signal);if(!controller.signal.aborted){if(!value?.values)throw Error('Weather data unavailable');setPoint(value);}}
    catch(error){if(!controller.signal.aborted)setPointError(error.kind==='offline'?'Weather is offline. Check your connection and retry.':error.kind==='timeout'?'Weather request timed out. Please retry.':'Location weather is unavailable or cooling down. Please retry shortly.');}
    finally{if(request.current===controller)setPointBusy(false);}
  }
  function here() {
    const point=onViewCenter();
    if(!point){setPointError('Aim the centre of the globe view at Earth, then try again.');return;}
    setLatitude(point.latitude.toFixed(1));setLongitude(point.longitude.toFixed(1));loadPoint(point.latitude,point.longitude);
  }
  const age=point?Math.max(0,(weather.clock-Date.parse(point.valid_at))/60000):0;
  const field=weather.field;
  return <AnimatePresence>{open&&<SpatialSurface as="aside" side="right" className="weather-panel hud-panel hud-panel--right" aria-label="Live Earth weather">
    <div className="hud-panel__header"><div><div className="eyebrow"><Thermometer size={15}/> LIVE EARTH</div><h2>Weather</h2></div><button className="icon-button" aria-label="Close weather" onClick={onClose}><X size={20}/></button></div>
    <div className="hud-panel__body weather-panel__body">
      <section aria-labelledby="global-weather-title"><div className="weather-section-heading"><h3 id="global-weather-title">Global temperature</h3><span className={`weather-status is-${weather.state}`}>{field?weather.state.toUpperCase():weather.error?'UNAVAILABLE':'LOADING'}</span></div>
        <label className="weather-toggle"><input type="checkbox" checked={enabled} onChange={event=>onEnabled(event.target.checked)}/><span>Temperature layer</span></label>
        {!compatible&&<div className="inline-warning" role="status">Temperature cannot be draped on Google 3D Tiles.<button className="secondary-action" onClick={onCompatibleMap}>USE ESRI FOR WEATHER</button></div>}
        <label className="weather-opacity">Opacity <output>{Math.round(opacity*100)}%</output><input aria-label="Weather opacity" type="range" min="0" max="80" step="5" value={Math.round(opacity*100)} onChange={e=>onOpacity(Number(e.target.value)/100)}/></label>
        {field?<><div className="weather-palette" style={{background:TEMPERATURE_GRADIENT}}/><div className="weather-legend__ticks"><span>−60 °C</span><span>0</span><span>60 °C</span></div><p className="weather-valid">{field.kind==='analysis'?'Analysis':'Forecast'} valid <strong>{weatherTime(field.valid_at)}</strong></p><p className="weather-source">NOAA/NCEP GFS · 1° grid</p></>:<p role="status">{weather.error?'Global temperature is temporarily unavailable.':'Loading the global temperature field…'}</p>}
        {weather.error&&field&&<p className="inline-warning" role="status">Refresh unavailable. The cached field retains its original valid time.</p>}
        <button className="secondary-action" onClick={onRefresh} disabled={refreshCooling}>{refreshCooling?'REFRESH COOLDOWN':'CHECK FOR UPDATE'}</button>
      </section>
      <section aria-labelledby="point-weather-title"><h3 id="point-weather-title">Weather at a location</h3><button className="secondary-action weather-here" onClick={here} disabled={pointBusy}><Crosshair size={16}/> WEATHER AT VIEW CENTRE</button>
        <form className="weather-coordinates" onSubmit={event=>{event.preventDefault();loadPoint(Number(latitude),Number(longitude));}}><label>Latitude<input required aria-label="Weather latitude" type="number" min="-90" max="90" step="any" value={latitude} onChange={e=>setLatitude(e.target.value)}/></label><label>Longitude<input required aria-label="Weather longitude" type="number" min="-180" max="180" step="any" value={longitude} onChange={e=>setLongitude(e.target.value)}/></label><button className="primary-action" disabled={pointBusy}>{pointBusy?'LOADING…':'GET WEATHER'}</button></form>
        {pointError&&<p className="inline-warning" role="alert">{pointError}</p>}
        {point&&<div className="weather-point" role="status"><div className="weather-section-heading"><strong>{point.requested_latitude.toFixed(1)}°, {point.requested_longitude.toFixed(1)}°</strong><span>{point.state==='stale'||age>30?'CACHED · STALE':'CURRENT MODEL'}</span></div><p className="weather-condition">{condition(point.values.weather_code)}</p><dl className="weather-measurements">{[['Temperature','temperature_2m'],['Feels like','apparent_temperature'],['Humidity','relative_humidity_2m'],['Wind speed','wind_speed_10m'],['Wind from','wind_direction_10m'],['Precipitation','precipitation'],['Cloud cover','cloud_cover']].map(([label,key])=><div key={key}><dt>{label}</dt><dd>{Number.isFinite(point.values[key])?`${point.values[key]} ${point.units[key]||''}`:'Unavailable'}</dd></div>)}</dl><p className="weather-valid">Valid {weatherTime(point.valid_at)}<br/>Precipitation interval: {point.interval_seconds/60} min</p><small>Open-Meteo · GFS Global · current model data</small></div>}
      </section>
      <details><summary>Data & accuracy</summary><p>Model estimates, not station observations. The global 2 m field has 1° grid spacing; colour interpolation adds no resolution. Local GFS data is processed by Open-Meteo, with elevation adjustment. Coordinates are rounded to 0.1° for caching.</p>{field&&<p>GFS initialized {weatherTime(field.model_initialized_at)}. Retrieved {weatherTime(field.retrieved_at)}. Range {field.minimum_c} to {field.maximum_c} °C.</p>}{point&&<p>Model cell: {point.grid_latitude}°, {point.grid_longitude}°. Retrieved {weatherTime(point.retrieved_at)}. Initialization time is not supplied by this endpoint.</p>}</details>
      <footer className="weather-credits"><a href="https://nomads.ncep.noaa.gov/" target="_blank" rel="noreferrer">NOAA/NCEP GFS</a><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></footer>
    </div>
  </SpatialSurface>}</AnimatePresence>;
}
