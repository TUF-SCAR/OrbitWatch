import WeatherGallery from './WeatherGallery.jsx';
import { useLayoutEffect, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { Crosshair, Thermometer, X } from 'lucide-react';
import SpatialSurface from './SpatialSurface.jsx';
import { LocationWeatherDetails } from './LocationWeatherCard.jsx';
import { weatherTime } from '../utils/weatherFormatters.js';
import { WEATHER_FIELDS } from '../services/weatherFields.js';
import ObservedClouds from './ObservedClouds.jsx';
import NaturalEventsPanel from './NaturalEventsPanel.jsx';
import WeatherScale from './WeatherScale.jsx';
import './WeatherPanel.css';

export function TemperatureLegend({field,state,labelWeatherNote}) {
  const style=WEATHER_FIELDS[field.display_variable||'temperature'];
  return <aside className="weather-legend" aria-label="Weather legend"><WeatherScale variable={field.display_variable||'temperature'} field={field}/><small>{state==='stale'?'CACHED · STALE · ':''}GFS · 1° · {weatherTime(field.valid_at)} · <a href="https://nomads.ncep.noaa.gov/" target="_blank" rel="noreferrer">NOAA/NCEP</a></small>{style.units==='mm/h'&&<small>Liquid equivalent · {field.fields?.clouds?'GFS model clouds · ':''}{field.precipitation_phase_status==='available'?'GFS categorical phase · nearest node':'phase unavailable'}</small>}{labelWeatherNote&&<small>{labelWeatherNote}</small>}</aside>;
}
export default function WeatherPanel({onFocusEvent,onReturnEvent,windEnabled=false,onWindEnabled,windField,cameraAltitudeKm,cloudFallback=false,observedClouds,tab,onTab,events,eventsEnabled,onEventsEnabled,eventCategory,onEventCategory,selectedEventId,onEventSelect,open,onClose,weather,variable='temperature',onVariable,enabled,onEnabled,opacity,onOpacity,compatible,onCompatibleMap,onRefresh,refreshCooling,onViewCenter,locationWeather,labelWeatherNote}) {
  const bodyRef=useRef(null);
  useLayoutEffect(()=>{
    if(!open||!bodyRef.current)return;
    bodyRef.current.scrollTop=0;
    if(tab==='events'&&selectedEventId)bodyRef.current.querySelector('.event-inspector')?.scrollIntoView({block:'start',behavior:'instant'});
  },[open,tab,selectedEventId,eventCategory]);
  const field=weather.field;
  const availability=weather.availability;
  const observed=variable==='observedClouds'&&!cloudFallback;
  const style=WEATHER_FIELDS[cloudFallback?'clouds':variable];
  const working=['preparing','downloading','decoding'].includes(weather.state);
  const retryAt=Date.parse(availability?.next_attempt_at);
  const waiting=weather.state!=='available'&&Number.isFinite(retryAt)&&retryAt>weather.clock;
  const stateLabel=!field&&weather.bundle?'UNAVAILABLE':({preparing:'PREPARING',downloading:'DOWNLOADING',decoding:'PROCESSING',cooldown:'RETRY PAUSED',failed:'PROVIDER FAILED',offline:'OFFLINE',unavailable:'UNAVAILABLE'})[weather.state]||weather.state.toUpperCase();
  const failure=availability?.last_failure;
  const failureNote=({timeout:'The NOAA request timed out.',network_error:'NOAA could not be reached.',http_error:`NOAA returned HTTP ${failure?.http_status}.`,invalid_data:'The NOAA field could not be validated.',decoder_unavailable:'Temperature processing is unavailable on the backend.',unknown_prior_failure:'The previous NOAA request failed; its original cause was not recorded.',processing_error:'Temperature preparation failed.'})[failure?.category];
  const message=working?({preparing:'Preparing global model weather…',downloading:'Downloading the NOAA model fields…',decoding:'Processing and validating the NOAA field…'})[weather.state]:weather.state==='cooldown'?`NOAA retry is paused until ${weatherTime(availability.next_attempt_at)}.`:weather.state==='offline'?'Weather is offline. The next connection check is scheduled automatically.':availability?.providers_enabled===false?'Weather provider access is disabled. No usable global field is available.':availability?.data_state==='hard_expired'?'The previous field has expired. No temperature overlay is being shown.':'The selected global field is unavailable. A retry is scheduled automatically.';
  return <AnimatePresence>{open&&<SpatialSurface as="aside" side="right" className="weather-panel hud-panel hud-panel--right" aria-label="Live Earth weather">
    <div className="hud-panel__header"><div><div className="eyebrow"><Thermometer size={15}/> LIVE EARTH</div><h2>Weather</h2></div><button className="icon-button" aria-label="Close weather" onClick={onClose}><X size={20}/></button></div>
    <div className="weather-view-tabs" role="group" aria-label="Weather views"><button aria-pressed={tab==='layers'} onClick={()=>onTab('layers')}>WEATHER LAYERS</button><button aria-pressed={tab==='events'} onClick={()=>onTab('events')}>NATURAL EVENTS</button></div>
    <div className="hud-panel__body weather-panel__body" ref={bodyRef}>
      {tab==='events'?<NaturalEventsPanel onFocus={onFocusEvent} onReturn={onReturnEvent} data={events} enabled={eventsEnabled} onEnabled={onEventsEnabled} category={eventCategory} onCategory={onEventCategory} selectedId={selectedEventId} onSelect={onEventSelect}/>:<>
      <section aria-labelledby="global-weather-title"><div className="weather-section-heading"><h3 id="global-weather-title">Global weather</h3><span className={`weather-status is-${weather.state}`}>{observed?observedClouds.status.toUpperCase():stateLabel}</span></div>
        <WeatherGallery value={variable} onChange={onVariable}/>{labelWeatherNote&&<p className="weather-source" role="note">{labelWeatherNote}</p>}
        <label className="weather-toggle"><input type="checkbox" checked={enabled} onChange={event=>onEnabled(event.target.checked)}/><span>Weather layer</span></label>
        <div className="weather-wind-control">
          <label className="weather-toggle"><input type="checkbox" aria-label="Wind Flow" checked={windEnabled} onChange={event=>onWindEnabled(event.target.checked)}/><span>Wind Flow</span><b>{windEnabled?'ON':'OFF'}</b></label>
          <p className="weather-source">Independent 10 m wind overlay · keeps your selected weather layer.</p>
          {windEnabled&&<>
            {!enabled?<p className="weather-source" role="status">Paused · enable Weather layer to show wind.</p>:!compatible?<p className="weather-source" role="status">Paused · Wind Flow requires a compatible map.</p>:!windField?<p className="weather-source" role="status">Wind data {working?'is preparing from the shared NOAA bundle.':'is unavailable. No artificial flow is shown.'}</p>:<>
              <p className="weather-source">10 m modeled winds · speed displays in km/h · {weather.state==='stale'?'cached, stale · ':''}valid {weatherTime(windField.valid_at)}</p>
            </>}
            <p className="weather-source">NOAA GFS 10 m eastward/northward winds. Flow moves toward the wind direction with accelerated visual time; the 1° model adds no local detail. Reduced motion keeps the flow still.</p>
            {observed&&!windField&&<button className="secondary-action" onClick={onRefresh} disabled={refreshCooling||working||waiting}>CHECK WIND DATA</button>}
          </>}
        </div>
        {enabled&&Number.isFinite(cameraAltitudeKm)&&cameraAltitudeKm<250&&<p className="weather-source" role="status">{cameraAltitudeKm<=200?'Weather hidden below 200 km. Zoom out to restore.':'Weather fades between 250 and 200 km.'}</p>}
        {!observed&&enabled&&!field&&<p className="weather-source">Enabled · waiting for this model field</p>}
        {!observed&&!field&&weather.bundle&&<p className="weather-source" role="status">{style.label} is unavailable in this shared model bundle. Other weather fields remain available; the shared NOAA retry deadline is preserved.</p>}
        {!observed&&!field&&working&&availability?.data_state==='hard_expired'&&<p className="weather-source">The previous field expired and has been hidden.</p>}
        {!compatible&&<div className="inline-warning" role="status">Weather imagery cannot be draped on Google 3D Tiles.<button className="secondary-action" onClick={onCompatibleMap}>USE ESRI FOR WEATHER</button></div>}
        <label className="weather-opacity">Opacity <output>{Math.round(opacity*100)}%</output><input aria-label="Weather opacity" type="range" min="0" max="80" step="5" value={Math.round(opacity*100)} onChange={e=>onOpacity(Number(e.target.value)/100)}/></label>
        {observed?<ObservedClouds clouds={observedClouds} enabled={enabled}/>:<>
        {cloudFallback&&<p className="inline-warning" role="status">Observed imagery unavailable. Showing GFS modeled cloud fraction when available; this is not satellite imagery. <button className="secondary-action" onClick={observedClouds.refresh} disabled={observedClouds.clock<(observedClouds.diagnostics.retryAt||0)}>RETRY OBSERVATIONS</button></p>}
        {field?<><WeatherScale variable={field.display_variable||'temperature'} field={field}/><p className="weather-valid">{field.kind==='analysis'?'Analysis':'Forecast'} valid <strong>{weatherTime(field.valid_at)}</strong></p><p className="weather-source">NOAA/NCEP GFS · 1° grid · {style.units}</p>{variable==='precipitation'&&<p className="weather-source">Instantaneous liquid-equivalent rate, including frozen precipitation. Available GFS model cloud fraction is composited underneath; it is not observed satellite imagery. Streaks mark rain or unknown-phase activity; verified frozen/mixed cells have no rain streaks. Phase uses nearest model nodes; colours do not imply radar or snowfall depth. The 1° source limits local detail; not radar or accumulation.</p>}{variable==='clouds'&&<p className="weather-source">Forecast cloud fraction, not satellite-observed clouds.</p>}{variable==='humidity'&&<p className="weather-source">Modeled 2 m relative humidity (%), not ground-station observations.</p>}{variable==='pressure'&&<p className="weather-source">Modeled Mean Sea-Level Pressure (hPa), reduced to sea level; not surface pressure.</p>}{variable==='wind'&&<p className="weather-source">Animated flow follows modeled 10 m winds, with accelerated visual time. Interpolation adds no detail to the 1° source. Not tracked air parcels; motion is still when reduced motion is enabled.</p>}</>:<p role="status">{message}</p>}
        {weather.state==='stale'&&availability?.state==='cooldown'&&<p className="weather-source">Cached field retained. NOAA retry at {weatherTime(availability.next_attempt_at)}.</p>}
        {!field&&failureNote&&<p className="weather-source">{failureNote}</p>}
        {weather.error&&field&&<p className="inline-warning" role="status">Refresh unavailable. The cached field retains its original valid time.</p>}
        <button className="secondary-action" onClick={onRefresh} disabled={refreshCooling||working||waiting}>{working?'PREPARING DATA':waiting?`RETRY AT ${weatherTime(availability.next_attempt_at)}`:refreshCooling?'REFRESH COOLDOWN':'CHECK FOR UPDATE'}</button></>}
      </section>
      <section aria-labelledby="point-weather-title"><h3 id="point-weather-title">Weather at a location</h3><p className="weather-source">Click anywhere on Earth to inspect the weather. Visible city and state labels snap to their representative location.</p><button className="secondary-action weather-here" onClick={onViewCenter}><Crosshair size={16}/> WEATHER AT VIEW CENTRE</button>
        {locationWeather?.selection&&<><p className="weather-valid">{locationWeather.selection.name||`${locationWeather.selection.latitude.toFixed(2)}°, ${locationWeather.selection.longitude.toFixed(2)}°`}</p><LocationWeatherDetails weather={locationWeather}/></>}
      </section>
      <details><summary>Modeled weather accuracy</summary><p>Model estimates, not station observations. The global 2 m field has 1° grid spacing; colour interpolation adds no resolution. Local GFS data is processed by Open-Meteo, with elevation adjustment. Coordinates are rounded to 0.1° for caching.</p>{field&&(!field.display_variable||field.display_variable==='temperature')&&<p>GFS initialized {weatherTime(field.model_initialized_at)}. Retrieved {weatherTime(field.retrieved_at)}. Range {field.minimum_c} to {field.maximum_c} °C.</p>}</details>
      <footer className="weather-credits"><a href="https://nomads.ncep.noaa.gov/" target="_blank" rel="noreferrer">NOAA/NCEP GFS</a><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></footer>
    </>} </div>
  </SpatialSurface>}</AnimatePresence>;
}
