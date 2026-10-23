import { EVENT_CATEGORIES } from '../services/naturalEventLayer.js';

function time(value){return value?new Date(value).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC':'Unavailable';}
function sourceUrl(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}}

export default function NaturalEventsPanel({data,enabled,onEnabled,category,onCategory,selectedId,onSelect}){
  const selected=data.events.find(event=>event.id===selectedId);
  const events=data.events.filter(event=>category==='all'||event.category===category);
  const categories=new Set(data.events.map(event=>event.category));
  return <div className="natural-events">
    <label className="weather-toggle"><input type="checkbox" checked={enabled} onChange={e=>onEnabled(e.target.checked)}/><span>Reported event markers</span></label>
    <label className="weather-field-picker">Event category<select aria-label="Event category" value={category} onChange={e=>onCategory(e.target.value)}><option value="all">All reported categories</option>{Object.entries(EVENT_CATEGORIES).map(([key,spec])=><option value={key} key={key}>{spec.label}{categories.has(key)?'':' · no reports'}</option>)}</select></label>
    {selected&&<section className="event-inspector" aria-label="Selected natural event">
      <div className="weather-section-heading"><span style={{color:EVENT_CATEGORIES[selected.category]?.color}}>{EVENT_CATEGORIES[selected.category]?.label||selected.category}</span><button className="secondary-action" onClick={()=>onSelect(null)}>BACK TO REPORTS</button></div>
      <h3>{selected.title}</h3>
      <p className="weather-source">{selected.position[1].toFixed(3)}°, {selected.position[0].toFixed(3)}° · {selected.position_meaning}</p>
      <dl className="event-facts"><div><dt>Source</dt><dd>{selected.provider.toUpperCase()} · {selected.provider_event_id}</dd></div>
        <div><dt>Reported</dt><dd>{time(selected.reported_at)}</dd></div>{selected.updated_at&&<div><dt>Updated</dt><dd>{time(selected.updated_at)}</dd></div>}
        <div><dt>Source status</dt><dd>{selected.status||'Unavailable'}</dd></div>
        {selected.episode_status&&<div><dt>Latest source episode</dt><dd>{selected.source_episode_id} · {selected.episode_status}</dd></div>}
        {selected.measurements.length===0&&<div><dt>Quantified intensity</dt><dd>Not supplied</dd></div>}
        {selected.measurements.map((m,index)=><div key={index}><dt>{m.label}</dt><dd>{m.value} {m.units||''}{m.description&&<small>{m.description}</small>}</dd></div>)}
      </dl>
      {selected.description&&<p>{selected.description}</p>}
      <p className="weather-source">{selected.status_meaning}</p>
      {['cyclone','earthquake'].includes(selected.category)&&<p className="weather-source">Illustrative marker animation. Symbol size is not a geographical extent, danger radius or measured motion.</p>}
      {selected.geometry.type!=='Point'&&<p className="weather-source">Source-reported boundary shown. The marker is anchored at a supplied boundary vertex.</p>}
      {selected.timeline?.length>1&&<details><summary>{selected.timeline.length} source geometry reports</summary><p>No forecast track is inferred from these reports.</p><ol className="event-timeline">{selected.timeline.map((entry,i)=><li key={i}>{time(entry.at)} · {entry.geometry.type}{entry.geometry.type==='Point'?` · ${entry.geometry.coordinates[1].toFixed(2)}°, ${entry.geometry.coordinates[0].toFixed(2)}°`:''}</li>)}</ol></details>}
      <p className="weather-source">Retrieved {time(selected.retrieved_at)}{selected.data_state==='stale'?' · CACHED / STALE':''}</p>
      {sourceUrl(selected.source_url)&&<a className="event-report-link" href={sourceUrl(selected.source_url)} target="_blank" rel="noopener noreferrer">OPEN OFFICIAL SOURCE REPORT ↗</a>}
      {selected.related_ids?.length>0&&<p className="weather-source">Linked source identities: {selected.related_ids.join(', ')}</p>}
    </section>}
    {!selected&&<><div className="weather-section-heading"><h3>Recent reports</h3><span>{events.length}</span></div>
      {data.state==='preparing'&&<p role="status">Loading official event feeds…</p>}
      {data.state==='offline'&&<p className="inline-warning" role="status">Event service is unreachable. Retained reports keep their original timestamps.</p>}
      {events.length===0&&data.state!=='preparing'&&<p role="status">{data.state==='unavailable'?'No usable event feeds are available. Provider retry gates are preserved.':'No recent reports in this category from the available feeds.'}</p>}
      <ul className="event-list">{events.map(event=><li key={event.id}><button onClick={()=>{onEnabled(true);onSelect(event.id);}}><i style={{background:EVENT_CATEGORIES[event.category]?.color}}/><span><strong>{event.title}</strong><small>{event.provider.toUpperCase()} · {time(event.reported_at)}{event.data_state==='stale'?' · STALE':''}</small></span></button></li>)}</ul>
    </>}
    <details><summary>Providers & reporting limits</summary>{Object.entries(data.providers).map(([provider,p])=><div className="event-provider" key={provider}><strong>{provider.toUpperCase()} · {p.state.toUpperCase()}</strong><p>{p.limitation}</p><p>{p.count} reports · Retrieved {time(p.retrieved_at)}</p>{p.failure&&<p>Provider {p.failure.replaceAll('_',' ')}{p.http_status?` (HTTP ${p.http_status})`:''}. Retry no sooner than {p.retry_after_seconds} s.</p>}</div>)}<p>FIRMS hotspots are not enabled; a NASA MAP_KEY is required. No synthetic events are added to Live results.</p></details>
    <p className="weather-source">Educational visualization of reported natural events, not a public warning service. Consult official local authorities. Open reports may describe past incidents.</p>
  </div>;
}
