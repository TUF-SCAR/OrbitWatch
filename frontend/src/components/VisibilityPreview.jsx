import {useEffect,useMemo,useState} from 'react';
import {Clock,CloudMoon,MapPin,RefreshCw} from 'lucide-react';
import {createVisibilityPreview} from '../services/visibilityPreview.js';

function timeLabel(value,zone) {
  return new Intl.DateTimeFormat(undefined,{timeZone:zone,weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
}

export default function VisibilityPreview({account,kind}) {
  const {state}=account,locations=state.locations||[];
  const [selected,setSelected]=useState(''),[revision,setRevision]=useState(0);
  const [preview,setPreview]=useState({phase:'idle',data:null,error:''});
  const location=locations.find(row=>row.id===selected)||locations.find(row=>row.is_default)||locations[0];
  const targets=state.subscriptions.filter(row=>row.kind===kind).map(row=>row.target_id).sort().join(',');
  const locationId=location?.id;
  const controller=useMemo(()=>createVisibilityPreview(),[]);
  useEffect(()=>()=>controller.destroy(),[controller]);
  useEffect(()=>{
    if(locationId&&targets)controller.load(kind,locationId,targets.split(','),setPreview);
    return ()=>controller.cancel?.();
  },[controller,kind,locationId,targets,revision]);
  // Old data is hidden synchronously before the new request effect runs.
  const data=preview.data?.location.id===locationId&&preview.data?.collectionKind===kind?preview.data:null;
  const items=data?.items.filter(item=>targets.split(',').includes(item.target_id))||[];
  return <section className="visibility-preview" aria-label="Observation visibility preview">
    <div className="account-section-title"><h3><CloudMoon size={17}/> Viewing opportunities</h3><button type="button" aria-label="Refresh visibility predictions" disabled={preview.phase==='loading'||!location||!targets} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={14}/></button></div>
    {!location?<p className="sky-empty">Save an observation location in Locations to calculate real viewing opportunities.</p>:<>
      <label className="visibility-location"><MapPin size={14}/><span>Observe from</span><select value={location.id} onChange={event=>setSelected(event.target.value)} aria-label="Observation location">{locations.map(row=><option key={row.id} value={row.id}>{row.name} · {row.timezone}</option>)}</select></label>
      {!targets&&<p className="account-muted">Follow a {kind==='satellite'?'satellite':'planet or the Moon'} to preview its next viewing window.</p>}
      {targets&&preview.phase==='loading'&&<p role="status" className="account-muted">Calculating topocentric viewing windows…</p>}
      {targets&&preview.error&&<p role="alert" className="account-inline-error">{preview.error}</p>}
      <div className="visibility-cards">{items.map(item=>{
        const window=item.windows[0],weather=window?.weather;
        return <article className="visibility-card" key={item.target_id}><strong>{item.target_name}</strong>
          {window?<><p><Clock size={13}/> <time dateTime={window.start_utc}>{timeLabel(window.start_utc,location.timezone)}</time></p><p>{Math.round(window.max_elevation_degrees)}° maximum elevation · {window.status}</p><small>{weather?.state==='available'?`${weather.cloud_cover_percent}% cloud · ${weather.precipitation_probability_percent}% precipitation probability`:'Weather forecast unavailable'}</small>
            <details><summary>Prediction details</summary><p>Ends {timeLabel(window.end_utc,location.timezone)} · azimuth at maximum {window.azimuth_degrees}°</p><p>Sun altitude {window.sun_altitude_degrees===null?'unavailable':`${window.sun_altitude_degrees}°`}{window.sunlit_at_maximum!==undefined&&window.sunlit_at_maximum!==null?` · satellite ${window.sunlit_at_maximum?'sunlit':'eclipsed'} at maximum`:''}</p>{window.useful_segments?.length>0&&<p>First screened segment: {timeLabel(window.useful_segments[0].start_utc,location.timezone)} – {timeLabel(window.useful_segments[0].end_utc,location.timezone)}</p>}<p>{item.brightness||item.equipment}</p>{item.moon_illumination_percent!==null&&item.moon_illumination_percent!==undefined&&<p>Moon illuminated: {item.moon_illumination_percent}%</p>}{item.rise_set?.map(event=><p key={event.utc}>{event.event}: {timeLabel(event.utc,location.timezone)}</p>)}<p>{item.source}</p>{item.element_epoch&&<p>Element epoch: {item.element_epoch} · age {item.element_age_days} days</p>}<p>Calculated {timeLabel(item.computed_at,location.timezone)} · interval screening precision {window.segment_precision_seconds} s</p>{weather?.state==='available'&&<p>{weather.attribution} · valid {timeLabel(weather.valid_at,location.timezone)} · fetched {timeLabel(weather.retrieved_at,location.timezone)}</p>}<p>Geometric altitude; local obstructions and atmospheric refraction are not modeled. Never aim optical equipment at the Sun.</p></details>
          </>:<p className="account-muted">{item.reason||'Prediction unavailable'}</p>}
        </article>;
      })}</div>
      {data&&<p className="account-muted">24-hour preview · refreshed {timeLabel(data.generated_at,location.timezone)}. {data.items.some(item=>item.computed_at&&new Date(data.generated_at).getTime()-new Date(item.computed_at).getTime()>300000)?'Calculation is over five minutes old; refresh to update. ':''}Geometry and forecast conditions are separate; visibility is not guaranteed.</p>}
    </>}
    <small className="account-muted">On-demand preview only. Scheduled notifications are upcoming.</small>
  </section>;
}
