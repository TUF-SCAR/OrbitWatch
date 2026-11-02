import {useState,useEffect} from 'react';
import {EVENT_CATEGORIES} from '../data/eventCategories.js';
import {eventFilter,trackPoints} from '../services/cycloneTracks.js';

function time(value){const d=new Date(value);return value&&Number.isFinite(d.getTime())?d.toISOString().slice(0,16).replace('T',' ')+' UTC':'Unavailable';}
function sourceUrl(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}}

export default function NaturalEventsPanel({data,enabled,onEnabled,category,onCategory,selectedId,onSelect,onFocus,onReturn}){
  const [filter,setFilter]=useState({provider:'all',status:'all',limit:40});
  const [clock,setClock]=useState(Date.now);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),60000);return()=>clearInterval(timer);},[]);
  const selected=data.events.find(event=>event.id===selectedId);
  const events=eventFilter(data.events,{category,provider:filter.provider,status:filter.status,now:clock});
  const categories=new Set(data.events.map(event=>event.category));
  const observed=trackPoints(selected?.track,'observed',clock),forecast=trackPoints(selected?.track,'forecast',clock);
  const latest=observed.at(-1);
  function change(key,value){setFilter(previous=>({...previous,[key]:value,limit:key==='limit'?value:40}));}
  function back(){onReturn?.();onSelect(null);}
  return <div className="natural-events">
    <label className="weather-toggle"><input type="checkbox" checked={enabled} onChange={e=>onEnabled(e.target.checked)}/><span>Reported event markers & tracks</span></label>
    <label className="weather-field-picker">Event category<select aria-label="Event category" value={category} onChange={e=>{onReturn?.();onCategory(e.target.value);change('limit',40);}}><option value="all">All reported categories</option>{Object.entries(EVENT_CATEGORIES).map(([key,spec])=><option value={key} key={key}>{spec.label}{categories.has(key)?'':' · no reports'}</option>)}</select></label>
    {!selected&&<div className="event-filters" aria-label="Report list filters"><label>Source<select aria-label="Event source" value={filter.provider} onChange={e=>change('provider',e.target.value)}><option value="all">All sources</option>{Object.keys(data.providers).map(p=><option key={p} value={p}>{p.toUpperCase()}</option>)}</select></label><label>Report context<select aria-label="Event report context" value={filter.status} onChange={e=>change('status',e.target.value)}><option value="all">All loaded reports</option><option value="recent">Reported in 7 days</option><option value="older">Older source-monitored</option><option value="tracks">Cyclone tracks</option><option value="fresh">Source cache fresh</option><option value="stale">Source cache stale</option></select></label><small>List filters · the map follows the selected category.</small></div>}
    {selected&&<section className="event-inspector" aria-label="Selected natural event">
      <div className="weather-section-heading"><span style={{color:EVENT_CATEGORIES[selected.category]?.color}}>{EVENT_CATEGORIES[selected.category]?.label||selected.category}</span><button className="secondary-action" onClick={back}>BACK TO REPORTS</button></div>
      <h3>{selected.title}</h3>
      <div className="event-actions"><button className="primary-action" onClick={()=>onFocus?.(selected.id)}>{selected.track?'VIEW TRACK / FOCUS STORM':'VIEW REPORTED GEOMETRY'}</button><button className="secondary-action" onClick={()=>onReturn?.()}>RETURN TO PREVIOUS VIEW</button></div>
      <p className="weather-source">{selected.position?`${selected.position[1].toFixed(3)}°, ${selected.position[0].toFixed(3)}° · `:''}{selected.position_meaning}</p>
      <dl className="event-facts"><div><dt>Source identity</dt><dd>{selected.provider.toUpperCase()} · {selected.provider_event_id}</dd></div>
        <div><dt>First source report / event start</dt><dd>{time(selected.started_at)}</dd></div><div><dt>Last reported position / report</dt><dd>{time(selected.last_report_at||selected.reported_at)}</dd></div>
        <div><dt>Reported position / report age</dt><dd>{Math.max(0,Math.floor((clock-Date.parse(selected.last_report_at||selected.reported_at))/3600000))} h · does not verify ongoing hazard activity</dd></div>
        <div><dt>Last source modification</dt><dd>{time(selected.source_updated_at||selected.updated_at)}</dd></div>
        <div><dt>Verified material change</dt><dd>{selected.material_update?`${selected.material_update.kind.replaceAll('_',' ')} · ${time(selected.material_update.at)}`:'Not verified from comparable source revisions'}</dd></div>
        <div><dt>Overall source status</dt><dd>{selected.status||'Unavailable'}</dd></div>
        {selected.episode_status&&<div><dt>Latest episode alert</dt><dd>Episode {selected.source_episode_id} · {selected.episode_status}</dd></div>}
        {selected.measurements.length===0&&<div><dt>Quantified intensity</dt><dd>Not supplied</dd></div>}
        {selected.measurements.map((m,index)=><div key={index}><dt>{m.label}</dt><dd>{m.value} {m.units||''}{m.description&&<small>{m.description}</small>}</dd></div>)}
      </dl>
      {selected.track&&<section className="cyclone-track-details" aria-label="Cyclone track details"><h3>Source track</h3><p className="weather-source">{selected.track.source} · {selected.track.official_id}{selected.track.basin?` · ${selected.track.basin} ${selected.track.season}`:''}</p>
        <div className="cyclone-track-legend"><span><i/>Solid · reported positions</span><span><i/>Dashed · official forecast</span></div>
        <p>{observed.length} reported positions<br/>{time(observed[0]?.at)} → {time(latest?.at)}</p>
        {latest&&<p className="weather-source">Latest: {latest.latitude.toFixed(2)}°, {latest.longitude.toFixed(2)}° · {latest.classification?.replaceAll('_',' ')} · {latest.agency}. {Number.isFinite(latest.wind)?`${latest.wind} ${latest.wind_units} · ${latest.wind_averaging_minutes||'unknown'}-minute averaging.`:'Wind intensity not supplied at this point.'}</p>}
        {forecast.length?<><p>Official forecast: {time(forecast[0].at)} → {time(forecast.at(-1).at)}</p><p className="weather-source">Issued {time(selected.track.issued_at)} · expires {time(selected.track.expires_at)} · {selected.track.forecast_source||selected.track.source}. Forecast passage is not certain impact.</p></>:<p className="inline-warning">No verified forecast track available.</p>}
        <p className="weather-source">{selected.track.note} Lines connect supplied positions geographically; they do not simulate elapsed storm motion. Point colours indicate reported intensity only for known 1-minute wind conventions, otherwise neutral. No landfall, probability or danger radius is inferred.</p>
        <details><summary>Dated track positions</summary><ol className="event-timeline">{[...observed.map(p=>({...p,kind:'Reported'})),...forecast.map(p=>({...p,kind:'Forecast'}))].map((p,i)=><li key={i}>{p.kind} · {time(p.at)} · {p.latitude.toFixed(2)}°, {p.longitude.toFixed(2)}°{Number.isFinite(p.wind)?` · ${p.wind} ${p.wind_units} (${p.wind_averaging_minutes||'?'} min)`:''}</li>)}</ol></details>
      </section>}
      {selected.category==='cyclone'&&!selected.track&&<p className="inline-warning">No verified forecast track available. This source supplies no validated observed route; its ordinary report remains available.</p>}
      {selected.description&&<p className="weather-source">{selected.description}</p>}
      <p className="weather-source">{selected.status_meaning} Physical hazard activity has not been independently verified. A recent report or an open curated record is not an active emergency designation.</p>
      {['cyclone','earthquake'].includes(selected.category)&&<p className="weather-source">Illustrative stationary marker animation. Symbol size is not a geographical extent or measured motion.</p>}
      {['Polygon','MultiPolygon'].includes(selected.geometry?.type)&&<p className="weather-source">Source-reported boundary; no precise centre marker is invented. Polygon holes and components are preserved.</p>}
      {selected.provider==='gdacs'&&<><button className="secondary-action" disabled={data.boundaryStatus?.id===selected.id&&data.boundaryStatus.state==='loading'} onClick={()=>data.loadBoundary?.(selected.id)}>LOAD OFFICIAL SOURCE BOUNDARIES</button>{data.boundaryStatus?.id===selected.id&&<p className="weather-source" role="status">{data.boundaryStatus.state==='loading'?'Requesting one bounded source geometry product…':data.boundaryStatus.message}</p>}<p className="weather-source">Optional boundaries may include forecast/impact products. They are not treated as a verified current danger area or used for automatic alerts.</p></>}
      <p className="weather-source">Retrieved {time(selected.retrieved_at)} · {selected.data_state==='stale'?'CACHED / STALE':'SOURCE CACHE FRESH'}. Retrieval is not a new event timestamp. Source cache validated {time(selected.provider_validated_at)}.</p>
      {sourceUrl(selected.source_url)&&<a className="event-report-link" href={sourceUrl(selected.source_url)} target="_blank" rel="noopener noreferrer">OPEN OFFICIAL SOURCE REPORT ↗</a>}
      {selected.related_ids?.length>0&&<p className="weather-source">Linked source identities: {selected.related_ids.join(', ')}</p>}
    </section>}
    {!selected&&<><div className="weather-section-heading"><h3>Reported events</h3><span>{events.length} / {data.events.length} loaded</span></div>
      {data.state==='preparing'&&<p role="status">Loading official event feeds…</p>}
      {data.state==='offline'&&<p className="inline-warning" role="status">Event service unreachable. Retained reports keep their original timestamps.</p>}
      {events.length===0&&data.state!=='preparing'&&<p role="status">No usable reports match these list filters. This does not mean no hazard exists.</p>}
      {data.coverage?.truncated&&<p className="weather-source">Showing a fair bounded subset of {data.coverage.normalized_reports} normalized reports. Up to {data.coverage.provider_cap} per source / {data.coverage.display_cap} total; coverage is incomplete.</p>}
      <ul className="event-list">{events.slice(0,filter.limit).map(event=><li key={event.id}><button onClick={()=>{onEnabled(true);onSelect(event.id);}}><i style={{background:EVENT_CATEGORIES[event.category]?.color}}/><span><strong>{event.title}</strong><small>{event.provider.toUpperCase()} · {time(event.last_report_at||event.reported_at)}{event.track?' · TRACK':''}{event.data_state==='stale'?' · STALE':''}</small><small>{event.status||'Source status unavailable'}{clock-Date.parse(event.reported_at)>30*86400000?' · OLDER SOURCE REPORT':''}</small></span></button></li>)}</ul>
      {events.length>filter.limit&&(filter.limit<200?<button className="secondary-action event-more" onClick={()=>change('limit',Math.min(200,filter.limit+40))}>SHOW 40 MORE REPORTS</button>:<p className="weather-source">List limited to 200 rows. Refine the category, source or report context to inspect more loaded reports.</p>)}
    </>}
    <details><summary>Providers & reporting limits</summary>{Object.entries(data.providers).map(([provider,p])=><div className="event-provider" key={provider}><strong>{provider.toUpperCase()} · {p.state.toUpperCase()}</strong><p>{p.limitation}</p><p>{p.count} normalized reports · Retrieved {time(p.retrieved_at)} · Validated {time(p.validated_at)} · Latest observation {time(p.latest_observation)}</p>{p.coverage?.truncated&&<p className="inline-warning">Source result/page limit reached; coverage is incomplete.</p>}{p.coverage?.notes?.map((note,i)=><p key={i}>{note}</p>)}{p.failure&&<p>Provider {p.failure.replaceAll('_',' ')}{p.http_status?` (HTTP ${p.http_status})`:''}. Retry no sooner than {p.retry_after_seconds} s.</p>}</div>)}{Object.entries(data.optional_sources||{}).map(([key,value])=><p key={key}>{key.toUpperCase()}: {value}</p>)}<p>NOAA IBTrACS v4r01 / NCEI, NASA EONET, USGS and Global Disaster Alert and Coordination System (GDACS). No synthetic events are added to Live results.</p></details>
    <p className="weather-source">Educational visualization of reported natural events, not a public warning service or complete global disaster inventory. Consult official local authorities. Open reports may describe past incidents.</p>
  </div>;
}
