import WeatherGallery from './WeatherGallery.jsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Crosshair, Thermometer, X } from 'lucide-react';
import SpatialSurface from './SpatialSurface.jsx';
import { fetchLocationWeather } from '../services/orbitwatchApi.js';
import { weatherFreshness } from '../services/temperatureGrid.js';
import { WEATHER_FIELDS } from '../services/weatherFields.js';
import ObservedClouds from './ObservedClouds.jsx';
import NaturalEventsPanel from './NaturalEventsPanel.jsx';
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
  const style=WEATHER_FIELDS[field.display_variable||'temperature'];
  return <aside className="weather-legend" aria-label="Weather legend"><div><strong>{style.title} · {style.units}</strong><span>{state==='stale'?'CACHED · STALE':'GFS · 1°'}</span></div><i style={{background:style.gradient}}/><div className="weather-legend__ticks">{style.ticks.map(tick=><span key={tick}>{tick}</span>)}</div><small>{field.kind==='analysis'?'Analysis':'Forecast'} valid {weatherTime(field.valid_at)} · <a href="https://nomads.ncep.noaa.gov/" target="_blank" rel="noreferrer">NOAA/NCEP</a></small></aside>;
}
export default function WeatherPanel({cameraAltitudeKm,cloudFallback=false,observedClouds,tab,onTab,events,eventsEnabled,onEventsEnabled,eventCategory,onEventCategory,selectedEventId,onEventSelect,open,onClose,weather,variable='temperature',onVariable,enabled,onEnabled,opacity,onOpacity,compatible,onCompatibleMap,onRefresh,refreshCooling,onViewCenter}) {
  const [latitude,setLatitude]=useState(''),[longitude,setLongitude]=useState(''),[point,setPoint]=useState(null),[pointError,setPointError]=useState(''),[pointBusy,setPointBusy]=useState(false);
  const request=useRef(null),lastAttempt=useRef(0);
  const [pointClock,setPointClock]=useState(Date.now);
  useEffect(()=>{
    if(!open)return;
    const timer=setInterval(()=>setPointClock(Date.now()),30000);
    return()=>clearInterval(timer);
  },[open]);
  const bodyRef=useRef(null);
  useLayoutEffect(()=>{
    if(!open||!bodyRef.current)return;
    bodyRef.current.scrollTop=0;
    if(tab==='events'&&selectedEventId)bodyRef.current.querySelector('.event-inspector')?.scrollIntoView({block:'start',behavior:'instant'});
  },[open,tab,selectedEventId,eventCategory]);
  useEffect(()=>{if(!open||tab!=='layers')request.current?.abort();return()=>request.current?.abort();},[open,tab]);
  async function loadPoint(lat,lon) {
    if(Date.now()-lastAttempt.current<2000)return;
    lastAttempt.current=Date.now();request.current?.abort();const controller=new AbortController();request.current=controller;
    setPointBusy(true);setPointError('');setPoint(null);setPointClock(Date.now());
    try {const value=await fetchLocationWeather(lat,lon,controller.signal);if(!controller.signal.aborted){if(!value?.values)throw Error('Weather data unavailable');setPoint(value);}}
    catch(error){if(!controller.signal.aborted)setPointError(error.kind==='offline'?'Weather is offline. Check your connection and retry.':error.kind==='timeout'?'Weather request timed out. Please retry.':'Location weather is unavailable or cooling down. Please retry shortly.');}
    finally{if(request.current===controller)setPointBusy(false);}
  }
  function here() {
    const point=onViewCenter();
    if(!point){setPointError('Aim the centre of the globe view at Earth, then try again.');return;}
    setLatitude(point.latitude.toFixed(1));setLongitude(point.longitude.toFixed(1));loadPoint(point.latitude,point.longitude);
  }
  const pointState=weatherFreshness(point,Math.max(weather.clock,pointClock),'location');
  const field=weather.field;
  const availability=weather.availability;
  const observed=variable==='observedClouds'&&!cloudFallback;
  const style=WEATHER_FIELDS[cloudFallback?'clouds':variable];
  const working=['preparing','downloading','decoding'].includes(weather.state);
  const retryAt=Date.parse(availability?.next_attempt_at);
  const waiting=weather.state!=='available'&&Number.isFinite(retryAt)&&retryAt>weather.clock;
  const stateLabel=({preparing:'PREPARING',downloading:'DOWNLOADING',decoding:'PROCESSING',cooldown:'RETRY PAUSED',failed:'PROVIDER FAILED',offline:'OFFLINE',unavailable:'UNAVAILABLE'})[weather.state]||weather.state.toUpperCase();
  const failure=availability?.last_failure;
  const failureNote=({timeout:'The NOAA request timed out.',network_error:'NOAA could not be reached.',http_error:`NOAA returned HTTP ${failure?.http_status}.`,invalid_data:'The NOAA field could not be validated.',decoder_unavailable:'Temperature processing is unavailable on the backend.',unknown_prior_failure:'The previous NOAA request failed; its original cause was not recorded.',processing_error:'Temperature preparation failed.'})[failure?.category];
  const message=working?({preparing:'Preparing global model weather…',downloading:'Downloading the NOAA model fields…',decoding:'Processing and validating the NOAA field…'})[weather.state]:weather.state==='cooldown'?`NOAA retry is paused until ${weatherTime(availability.next_attempt_at)}.`:weather.state==='offline'?'Weather is offline. The next connection check is scheduled automatically.':availability?.providers_enabled===false?'Weather provider access is disabled. No usable global field is available.':availability?.data_state==='hard_expired'?'The previous field has expired. No temperature overlay is being shown.':'The selected global field is unavailable. A retry is scheduled automatically.';
  return <AnimatePresence>{open&&<SpatialSurface as="aside" side="right" className="weather-panel hud-panel hud-panel--right" aria-label="Live Earth weather">
    <div className="hud-panel__header"><div><div className="eyebrow"><Thermometer size={15}/> LIVE EARTH</div><h2>Weather</h2></div><button className="icon-button" aria-label="Close weather" onClick={onClose}><X size={20}/></button></div>
    <div className="weather-view-tabs" role="group" aria-label="Weather views"><button aria-pressed={tab==='layers'} onClick={()=>onTab('layers')}>WEATHER LAYERS</button><button aria-pressed={tab==='events'} onClick={()=>onTab('events')}>NATURAL EVENTS</button></div>
    <div className="hud-panel__body weather-panel__body" ref={bodyRef}>
      {tab==='events'?<NaturalEventsPanel data={events} enabled={eventsEnabled} onEnabled={onEventsEnabled} category={eventCategory} onCategory={onEventCategory} selectedId={selectedEventId} onSelect={onEventSelect}/>:<>
      <section aria-labelledby="global-weather-title"><div className="weather-section-heading"><h3 id="global-weather-title">Global weather</h3><span className={`weather-status is-${weather.state}`}>{observed?observedClouds.status.toUpperCase():stateLabel}</span></div>
        <WeatherGallery value={variable} onChange={onVariable}/>
        <label className="weather-toggle"><input type="checkbox" checked={enabled} onChange={event=>onEnabled(event.target.checked)}/><span>Weather layer</span></label>
        {enabled&&Number.isFinite(cameraAltitudeKm)&&cameraAltitudeKm<250&&<p className="weather-source" role="status">{cameraAltitudeKm<=200?'Weather hidden below 200 km. Zoom out to restore.':'Weather fades between 250 and 200 km.'}</p>}
        {!observed&&enabled&&!field&&<p className="weather-source">Enabled · waiting for this model field</p>}
        {!observed&&!field&&weather.bundle&&<p className="weather-source">This variable is not in the usable cache yet. Temperature remains available; the shared NOAA retry deadline is preserved.</p>}
        {!observed&&!field&&working&&availability?.data_state==='hard_expired'&&<p className="weather-source">The previous field expired and has been hidden.</p>}
        {!compatible&&<div className="inline-warning" role="status">Weather imagery cannot be draped on Google 3D Tiles.<button className="secondary-action" onClick={onCompatibleMap}>USE ESRI FOR WEATHER</button></div>}
        <label className="weather-opacity">Opacity <output>{Math.round(opacity*100)}%</output><input aria-label="Weather opacity" type="range" min="0" max="80" step="5" value={Math.round(opacity*100)} onChange={e=>onOpacity(Number(e.target.value)/100)}/></label>
        {observed?<ObservedClouds clouds={observedClouds} enabled={enabled}/>:<>
        {cloudFallback&&<p className="inline-warning" role="status">Observed imagery unavailable. Showing GFS modeled cloud fraction when available; this is not satellite imagery. <button className="secondary-action" onClick={observedClouds.refresh} disabled={observedClouds.clock<(observedClouds.diagnostics.retryAt||0)}>RETRY OBSERVATIONS</button></p>}
        {field?<><div className="weather-palette" style={{background:style.gradient}}/><div className="weather-legend__ticks">{style.ticks.map(tick=><span key={tick}>{tick}</span>)}</div><p className="weather-valid">{field.kind==='analysis'?'Analysis':'Forecast'} valid <strong>{weatherTime(field.valid_at)}</strong></p><p className="weather-source">NOAA/NCEP GFS · 1° grid · {style.units}</p>{variable==='precipitation'&&<p className="weather-source">Instantaneous liquid-equivalent rate, including frozen precipitation. Streaks symbolize modeled activity, not falling-drop speed or rain/snow classification. The 1° source limits local detail; not radar or accumulation.</p>}{variable==='clouds'&&<p className="weather-source">Forecast cloud fraction, not satellite-observed clouds.</p>}{variable==='wind'&&<p className="weather-source">Animated flow follows modeled 10 m winds, with accelerated visual time. Interpolation adds no detail to the 1° source. Not tracked air parcels; motion is still when reduced motion is enabled.</p>}</>:<p role="status">{message}</p>}
        {weather.state==='stale'&&availability?.state==='cooldown'&&<p className="weather-source">Cached field retained. NOAA retry at {weatherTime(availability.next_attempt_at)}.</p>}
        {!field&&failureNote&&<p className="weather-source">{failureNote}</p>}
        {weather.error&&field&&<p className="inline-warning" role="status">Refresh unavailable. The cached field retains its original valid time.</p>}
        <button className="secondary-action" onClick={onRefresh} disabled={refreshCooling||working||waiting}>{working?'PREPARING DATA':waiting?`RETRY AT ${weatherTime(availability.next_attempt_at)}`:refreshCooling?'REFRESH COOLDOWN':'CHECK FOR UPDATE'}</button></>}
      </section>
      <section aria-labelledby="point-weather-title"><h3 id="point-weather-title">Weather at a location</h3><button className="secondary-action weather-here" onClick={here} disabled={pointBusy}><Crosshair size={16}/> WEATHER AT VIEW CENTRE</button>
        <form className="weather-coordinates" onSubmit={event=>{event.preventDefault();loadPoint(Number(latitude),Number(longitude));}}><label>Latitude<input required aria-label="Weather latitude" type="number" min="-90" max="90" step="any" value={latitude} onChange={e=>setLatitude(e.target.value)}/></label><label>Longitude<input required aria-label="Weather longitude" type="number" min="-180" max="180" step="any" value={longitude} onChange={e=>setLongitude(e.target.value)}/></label><button className="primary-action" disabled={pointBusy}>{pointBusy?'LOADING…':'GET WEATHER'}</button></form>
        {pointError&&<p className="inline-warning" role="alert">{pointError}</p>}
        {point&&pointState==='unavailable'&&<p role="status">The location reading has expired. Request an update to see current weather.</p>}
        {point&&pointState!=='unavailable'&&<div className="weather-point" role="status"><div className="weather-section-heading"><strong>{point.requested_latitude.toFixed(1)}°, {point.requested_longitude.toFixed(1)}°</strong><span>{pointState==='stale'?'CACHED · STALE':'CURRENT MODEL'}</span></div><p className="weather-condition">{condition(point.values.weather_code)}</p><dl className="weather-measurements">{[['Temperature','temperature_2m'],['Feels like','apparent_temperature'],['Humidity','relative_humidity_2m'],['Wind speed','wind_speed_10m'],['Wind from','wind_direction_10m'],['Precipitation','precipitation'],['Cloud cover','cloud_cover']].map(([label,key])=><div key={key}><dt>{label}</dt><dd>{Number.isFinite(point.values[key])?`${point.values[key]} ${point.units[key]||''}`:'Unavailable'}</dd></div>)}</dl><p className="weather-valid">Valid {weatherTime(point.valid_at)}<br/>Precipitation interval: {point.interval_seconds/60} min</p><small>Open-Meteo · GFS Global · current model data</small></div>}
      </section>
      <details><summary>Modeled weather accuracy</summary><p>Model estimates, not station observations. The global 2 m field has 1° grid spacing; colour interpolation adds no resolution. Local GFS data is processed by Open-Meteo, with elevation adjustment. Coordinates are rounded to 0.1° for caching.</p>{field&&(!field.display_variable||field.display_variable==='temperature')&&<p>GFS initialized {weatherTime(field.model_initialized_at)}. Retrieved {weatherTime(field.retrieved_at)}. Range {field.minimum_c} to {field.maximum_c} °C.</p>}{point&&<p>Model cell: {point.grid_latitude}°, {point.grid_longitude}°. Retrieved {weatherTime(point.retrieved_at)}. Initialization time is not supplied by this endpoint.</p>}</details>
      <footer className="weather-credits"><a href="https://nomads.ncep.noaa.gov/" target="_blank" rel="noreferrer">NOAA/NCEP GFS</a><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></footer>
    </>} </div>
  </SpatialSurface>}</AnimatePresence>;
}
