import {MapPin,X} from 'lucide-react';
import SpatialSurface from './SpatialSurface.jsx';
import {weatherCondition,weatherMeasurement,weatherTime} from '../utils/weatherFormatters.js';

export function LocationWeatherDetails({weather}) {
  const {data,selection,state,freshness,error,retry,retryAt,clock,waitingUntil}=weather;
  if(!selection)return null;
  if(state==='loading')return <p className="weather-source" role="status">{waitingUntil>clock?'Waiting for the weather service retry window…':'Loading weather for this location…'}</p>;
  if(!data)return <div role="status"><p className="weather-source">{error||'This location reading has expired. Request an update.'}</p><button className="secondary-action" onClick={retry} disabled={Number.isFinite(retryAt)&&retryAt>clock}>Retry weather</button></div>;
  return <div className="location-weather-details" role="status">
    {selection.kind==='state'&&<p className="weather-source">{selection.country ? `State / province · ${selection.country}. ` : 'State / province. '}Weather at the representative label coordinate, not an average of the administrative area.</p>}
    <p className="weather-condition">{weatherCondition(data.values.weather_code)} <small>{freshness==='stale'?'CACHED · STALE':'CURRENT MODEL'}</small></p>
    <dl className="weather-measurements">
      {[['Temperature','temperature_2m'],['Feels like','apparent_temperature'],['Humidity','relative_humidity_2m'],['Wind speed','wind_speed_10m']].map(([label,key])=><div key={key}><dt>{label}</dt><dd>{weatherMeasurement(data,key)}</dd></div>)}
    </dl>
    <details><summary>More measurements</summary><dl className="weather-measurements">{[['Wind from','wind_direction_10m'],['Cloud cover','cloud_cover'],['Precipitation','precipitation'],['Mean Sea-Level Pressure','pressure_msl']].map(([label,key])=><div key={key}><dt>{label}</dt><dd>{weatherMeasurement(data,key)}</dd></div>)}</dl><p className="weather-source">Precipitation interval: {Number.isFinite(data.interval_seconds)?`${data.interval_seconds/60} min`:'Unavailable'}<br/>Model cell: {data.grid_latitude}°, {data.grid_longitude}°<br/>Retrieved {weatherTime(data.retrieved_at)}. Initialization time is not supplied by this endpoint.</p></details>
    <p className="weather-valid">Valid {weatherTime(data.valid_at)}</p>
    <small><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · GFS Global model · not station observations. Coordinates cached at 0.1°.</small>
  </div>;
}

export default function LocationWeatherCard({weather,onSaveLocation}) {
  const selection=weather.selection;
  if(!selection)return null;
  const coordinates=`${selection.latitude.toFixed(2)}°, ${selection.longitude.toFixed(2)}°`;
  return <SpatialSurface as="aside" side="left" strength={1} className="location-weather-card" aria-label="Location weather inspector" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();weather.clear();}}}>
    <header><div><span className="eyebrow"><MapPin size={14}/> EARTH WEATHER</span><h2>{selection.name||coordinates}</h2>{selection.name&&<small>{coordinates}{selection.country?` · ${selection.country}`:''}</small>}</div><button className="icon-button" aria-label="Close location weather" onClick={weather.clear}><X size={18}/></button></header>
    <LocationWeatherDetails weather={weather}/>
    {onSaveLocation&&<button type="button" className="secondary-action" onClick={()=>onSaveLocation({...selection,name:selection.name||'Observation location'})}>Save this location</button>}
  </SpatialSurface>;
}
