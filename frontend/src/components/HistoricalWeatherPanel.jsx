import {Thermometer,X,MapPin} from 'lucide-react';
import ResponsivePanel from './ResponsivePanel.jsx';
import PhoneInspector from './PhoneInspector.jsx';
import {usePhoneUI} from '../utils/usePhoneUI.js';
import {HISTORICAL_FIELDS,hasHistoricalVariable} from '../services/historicalWeather.js';
import {seasonalChoices} from '../services/timeHistory.js';
import WeatherScale from './WeatherScale.jsx';
import './WeatherPanel.css';
const date=value=>new Date(value).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');
const attribution=<a href="https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels" target="_blank" rel="noreferrer">Copernicus / ECMWF ERA5 reanalysis</a>;

export function HistoricalWeatherLegend({weather,time}){
  const spec=HISTORICAL_FIELDS[weather.variable];
  return <div className="historical-weather-legend"><strong>{spec.label} · {spec.units}</strong>
    {weather.snapshot?.metadata?.provenance?.isolated_fixture&&<small>ISOLATED TEST FIXTURE · not downloaded ERA5</small>}
    <WeatherScale variable={weather.variable} units={spec.units}/>
    <p className="weather-source">{weather.variable==='precipitation'?'Precipitation during the preceding hour · mm. ':''}{date(time)} · 1° display grid.</p>
  </div>;
}

export default function HistoricalWeatherPanel({open,onClose,weather,time,onNearest,onViewCenter}){
  if(!open)return null;
  const w=weather;
  const isolated=w.coverage?.snapshots?.some(item=>item.provenance?.isolated_fixture);
  const seasons=seasonalChoices(w.coverage,time);
  return <ResponsivePanel onDismiss={onClose} as="aside" side="right" className="weather-panel historical-weather-panel hud-panel hud-panel--right" aria-label="Historical weather">
    <div className="hud-panel__header"><div><span className="eyebrow"><Thermometer size={15}/> TIME EXPLORER</span><h2>Historical weather</h2></div><button className="icon-button" aria-label="Close historical weather" onClick={onClose}><X size={20}/></button></div>
    <div className="hud-panel__body weather-panel__body">
      {isolated&&<p className="inline-warning" role="note">ISOLATED SCIENTIFIC TEST FIXTURES · these values were not downloaded from ERA5. Production has no fixtures.</p>}
      <section><div className="weather-section-heading"><h3>Seasonal climate archive</h3><span>{w.metadata?w.metadata.status.toUpperCase():'UNAVAILABLE'}</span></div>
        <p className="weather-valid">Scene: {date(time)}</p>
        <p className="weather-source">{w.coverage?`${w.coverage.stored_count} ${isolated?'isolated test':'ERA5'} snapshots stored`:'Checking the stored archive…'}<br/>Seasonal snapshots are dated January, April, July or October 15 at 12:00 UTC.</p>
        {seasons.length>1&&<div className="historical-season-switch" role="group" aria-label={`${time.getUTCFullYear()} stored seasons`}>
          {seasons.map(item=>{const stored=new Date(item.timestamp);return <button type="button" className="secondary-action" key={item.timestamp}
            aria-pressed={+stored===+time} onClick={()=>onNearest(stored)}>{stored.toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'})}</button>;})}
        </div>}
        {w.coverageError&&<p role="status" className="inline-warning">{w.coverageError}</p>}
        {!w.metadata&&<div className="inline-warning" role="status"><p>No authentic snapshot for this exact moment. Astronomy and satellites remain available.</p>
          {w.nearest?<><p>Nearest available <strong>{date(w.nearest.timestamp)}</strong></p><button className="secondary-action" onClick={()=>onNearest(new Date(w.nearest.timestamp))}>View nearest stored snapshot</button></>:<p>No stored snapshot is available to visit yet.</p>}
        </div>}
      </section>
      <label className="weather-toggle"><input type="checkbox" checked={w.enabled} disabled={!w.metadata} onChange={event=>w.setEnabled(event.target.checked)}/><span>Historical weather</span></label>
      <div className="weather-field-gallery map-gallery" role="group" aria-label="Historical weather variables">{Object.entries(HISTORICAL_FIELDS).map(([key,spec])=><button key={key} className={`map-card weather-field-card ${w.variable===key?'is-active':''}`} disabled={!hasHistoricalVariable(w.metadata,key)} aria-pressed={w.variable===key} onClick={()=>w.setVariable(key)}><span className="map-card__preview"><img src={`/weather-previews/${spec.preview==='wind'?'temperature':spec.preview}.svg`} alt="" width="320" height="120"/></span><span className="map-card__copy"><strong>{spec.label}</strong><small>{hasHistoricalVariable(w.metadata,key)?`ERA5 · ${spec.units}`:'Unavailable'}</small></span></button>)}</div>
      <div className="weather-wind-control"><label className="weather-toggle"><input type="checkbox" aria-label="Historical Wind Flow" checked={w.windEnabled} disabled={!hasHistoricalVariable(w.metadata,'wind')} onChange={event=>w.setWindEnabled(event.target.checked)}/><span>Wind Flow</span><b>{w.windEnabled?'ON':'OFF'}</b></label><p className="weather-source">Independent of the primary variable. Animated archived U/V vectors, with accelerated visual time; not footage of historical air movement. Reduced motion keeps flow still.</p></div>
      <label className="weather-opacity">Opacity <span>{Math.round(w.opacity*100)}%</span><input type="range" min="0" max="0.8" step="0.05" value={w.opacity} onChange={event=>w.setOpacity(Number(event.target.value))}/></label>
      {w.error&&<p className="inline-warning" role="status">{w.error}</p>}
      {w.enabled&&w.metadata&&!w.snapshot&&!w.error&&<p role="status" className="weather-source">Loading and validating the exact stored snapshot…</p>}
      {w.enabled&&w.snapshot&&!w.field&&<p role="status" className="weather-source">Selected variable unavailable. Choose an available field; no substitute is shown.</p>}
      {w.enabled&&w.field&&<HistoricalWeatherLegend weather={w} time={time}/>}
      <p className="weather-source">{attribution}. Atmospheric reconstruction from observations and physical models. Earlier estimates can be less constrained by observations. This is not satellite imagery or radar.</p>
      <button className="secondary-action historical-weather-here" disabled={!w.snapshot} onClick={onViewCenter}>Inspect Earth at view center</button>
      <p className="weather-source">Click Earth to inspect stored values. 1° spatial samples add no physical resolution; spatial interpolation is for display only. Missing nodes remain unavailable. Country, state and city labels show names only.</p>
      <p className="weather-source">Basemap imagery and place names remain modern reference material. Reanalysis does not date the basemap.</p>
    </div>
  </ResponsivePanel>;
}

export function HistoricalWeatherInspector({weather,time,inactive,onActivate}){
  const phone=usePhoneUI();
  if(!weather.selection)return null;
  const p=weather.selection,loc=weather.location,data=loc?.data;
  const measurement=(key,unit)=>Number.isFinite(data?.values?.[key])?`${data.values[key].toFixed(1)} ${unit}`:'Unavailable';
  if(phone)return <PhoneInspector key={`${p.latitude}:${p.longitude}`} side="left" title={p.name||'Selected location'} label="historical weather" onClose={()=>weather.select(null)} inactive={inactive} onActivate={onActivate} summary={<>{loc?.error?'Archived values unavailable':!loc?'Loading stored weather…':`${measurement('temperature','°C')} · Reanalysis`}<small>{date(time)}</small>{data?.provenance?.isolated_fixture&&<small>Isolated weather fixture</small>}</>}>
   {loc?.error&&<button onClick={()=>weather.select({...p})}>Retry stored values</button>}<dl>{[['Temperature','temperature','°C'],['Cloud fraction','clouds','%'],['Humidity','humidity','%'],['Pressure','pressure','hPa'],['Wind','wind_speed','km/h'],['Wind from true north','wind_direction','°'],['Preceding hour precipitation','precipitation','mm']].map(([label,key,unit])=><div key={key}><dt>{label}</dt><dd>{measurement(key,unit)}</dd></div>)}</dl><p>{p.latitude.toFixed(2)}°, {p.longitude.toFixed(2)}°</p><p>{attribution} · 1° display samples. Reconstructed atmosphere, not a station measurement.</p>
  </PhoneInspector>;
  return <ResponsivePanel onDismiss={()=>weather.select(null)} as="aside" side="left" className="location-weather-card historical-location-card hud-panel" aria-label="Historical weather inspector">
    <header><div><span className="eyebrow"><MapPin size={14}/> HISTORICAL REANALYSIS</span><h2>{p.name||'Earth location'}</h2><small>{p.latitude.toFixed(2)}°, {p.longitude.toFixed(2)}°</small></div><button className="icon-button" aria-label="Close historical inspector" onClick={()=>weather.select(null)}><X size={18}/></button></header>
    <div className="hud-panel__body"><p className="weather-valid">{date(time)}</p>
    {data?.provenance?.isolated_fixture&&<p className="inline-warning">ISOLATED SCIENTIFIC TEST FIXTURE · not downloaded ERA5.</p>}
    {!loc?<p role="status" className="weather-source">Loading stored location values…</p>:loc.error?<p role="status" className="weather-source">Archived values unavailable. Select the location again to retry.</p>:<dl className="weather-measurements">{[['Temperature','temperature','°C'],['Dewpoint','dewpoint','°C'],['Cloud fraction','clouds','%'],['Relative humidity','humidity','%'],['Mean sea-level pressure','pressure','hPa'],['10 m wind speed','wind_speed','km/h'],['Wind from true north','wind_direction','°'],['10 m eastward wind','u','m/s'],['10 m northward wind','v','m/s'],['Precipitation during the preceding hour','precipitation','mm']].map(([label,key,unit])=><div key={key}><dt>{label}</dt><dd>{measurement(key,unit)}</dd></div>)}</dl>}
    <p className="weather-source">{attribution} · 1° display samples, spatially interpolated at the selected coordinate. Reconstructed atmosphere, not a station measurement. Earlier observations may be sparse.</p>
    </div>
  </ResponsivePanel>;
}
