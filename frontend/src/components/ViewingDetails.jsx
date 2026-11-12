import {useEffect,useState} from 'react';

export function ViewingScore({assessment}) {
  if(!assessment)return <p className="account-muted">Score unavailable — scientific inputs are incomplete.</p>;
  return <div className="viewing-score"><strong>{assessment.score===null?'Score unavailable':`Viewing suitability: ${assessment.score}/100`}</strong><small>{assessment.state==='partial'?'Partial assessment · ':''}Suitability, not a probability of seeing the object.</small><details><summary>How this assessment works</summary><ul>{assessment.components.map(part=><li key={part.label}><b>{part.label}</b> · {part.points===null?'not scored':`${part.points}/${part.maximum}`}<br/>{part.detail}</li>)}</ul><p>{assessment.meaning}</p></details></div>;
}

const time=(value,zone)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat(undefined,{timeZone:zone,dateStyle:'medium',timeStyle:'long'}).format(new Date(value)):'Unavailable';
export default function ViewingDetails({details,expired=false}) {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
  const {window={},observer={},assessment,weather={}}=details,zone=observer.timezone||'UTC';
  const start=details.start_utc||window.start_utc,end=details.end_utc||window.end_utc,peak=details.peak_utc||window.maximum_at_utc;
  const azimuth=details.geometry?.azimuth_degrees??window.start_azimuth_degrees??window.azimuth_degrees;
  const hasDirection=Number.isFinite(azimuth),ended=expired||Date.parse(end)<=now,ongoing=Date.parse(start)<=now;
  return <section className="viewing-details" aria-label="Viewing opportunity details">
    <h3>{details.target_name||'Viewing opportunity'}</h3><p>{details.location_name} · {zone}</p>
    <strong>{ended?'This viewing opportunity has passed':ongoing?'Within the predicted viewing window':`Starts in ${Math.max(1,Math.ceil((Date.parse(start)-now)/60000))} minutes`}</strong>
    <p>{time(start,zone)} – {time(end,zone)}</p>
    {hasDirection&&<div className="viewing-compass"><svg viewBox="0 0 80 80" role="img" aria-label={`Look ${assessment?.direction||''}, azimuth ${Math.round(azimuth)} degrees clockwise from true north`}><circle cx="40" cy="40" r="29" fill="none" stroke="currentColor" opacity=".4"/><text x="40" y="8" textAnchor="middle" fill="currentColor" fontSize="9">N</text><path d="M40 16 34 43 40 39 46 43Z" fill="currentColor" transform={`rotate(${azimuth} 40 40)`}/><circle cx="40" cy="40" r="3" fill="currentColor"/></svg><span>{assessment?.direction||'True azimuth'} · {Math.round(azimuth)}°<br/>{window.max_elevation_degrees}° maximum elevation</span></div>}
    <ViewingScore assessment={assessment}/>
    <p>{weather.state==='available'?`Forecast: ${weather.cloud_cover_percent}% cloud, ${weather.precipitation_probability_percent}% precipitation chance, ${weather.precipitation_mm} mm hourly precipitation.`:'Forecast unavailable or stale. Clear skies are not assumed.'}</p>
    <p>{assessment?.equipment||details.equipment||details.brightness}</p><p>A predicted opportunity is a time to look for this object; local conditions can prevent observation.</p>
    <details className="viewing-science"><summary>Scientific details & sources</summary>
      {window.window_clipped&&<p>The search boundary clips this window. Timing and maximum elevation cover the searched interval and may not describe the complete opportunity.</p>}
      <p>Start: {time(start,'UTC')}<br/>Peak: {time(peak,'UTC')}<br/>End: {time(end,'UTC')}<br/>Duration: {Math.max(0,Math.round((Date.parse(end)-Date.parse(start))/1000))} seconds</p>
      <p>Observer: {observer.latitude}°, {observer.longitude}° · {zone}<br/>Azimuth start / peak / end: {window.start_azimuth_degrees??'unavailable'}° / {window.azimuth_degrees??'unavailable'}° / {window.end_azimuth_degrees??'unavailable'}°<br/>Sun altitude: {details.geometry?.sun_altitude_degrees??window.sun_altitude_degrees??'unavailable'}°<br/>Satellite illumination: {(details.geometry?.sunlit??window.sunlit??window.sunlit_at_maximum)===true?'sunlit':(details.geometry?.sunlit??window.sunlit??window.sunlit_at_maximum)===false?'eclipsed':'not applicable / unavailable'}</p>
      {details.moon_illumination_percent!=null&&<p>Moon illuminated: {details.moon_illumination_percent}%</p>}
      <p>{details.source}<br/>Orbital epoch: {time(details.element_epoch,'UTC')}<br/>Computed: {time(details.calculated_at||details.computed_at,'UTC')}<br/>Sampling precision: {details.sampling_precision_seconds??window.segment_precision_seconds??'unavailable'} seconds</p>
      {window.boundary_precision_seconds&&<p>Detected useful-window boundaries refined to within {window.boundary_precision_seconds} second. This is numerical timing resolution, not physical prediction accuracy.</p>}
      {details.element_epoch&&<p>Orbital data age at calculation: {Math.max(0,(Date.parse(details.calculated_at||details.computed_at)-Date.parse(details.element_epoch))/86400000).toFixed(2)} days</p>}
      {details.rise_set?.map(event=><p key={`${event.event}:${event.utc}`}>{event.event}: {time(event.utc,zone)}</p>)}
      <p>Weather: {weather.attribution||'unavailable'}<br/>Forecast valid: {time(weather.valid_at,zone)}<br/>Retrieved: {time(weather.retrieved_at,zone)}<br/>{weather.matching}</p>
      <p>{details.uncertainty||'No terrain, refraction, light pollution or verified satellite magnitude model. Forecasts and orbital predictions have uncertainty. Never aim optical equipment at the Sun.'}</p>
    </details>
  </section>;
}
