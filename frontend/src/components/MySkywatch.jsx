import {useState} from 'react';
import {Activity,Check,CloudFog,Flame,Globe2,MapPin,Moon,Mountain,Orbit,Satellite,Search,Snowflake,Sun,Thermometer,Wind,Waves} from 'lucide-react';
import {CELESTIAL_BODIES} from '../data/celestialBodies.js';
import {SPACE_OBJECTS} from '../data/spaceObjects.js';
import {EVENT_CATEGORIES} from '../data/eventCategories.js';
import AccountTabs from './AccountTabs.jsx';
import AccountNotificationSettings from './AccountNotificationSettings.jsx';
import {satelliteMatches} from '../services/accountSettings.js';

const PLANETS=['mercury','venus','mars','jupiter','saturn','uranus','neptune','moon'];
const ICONS={cyclone:Wind,earthquake:Activity,flood:Waves,wildfire:Flame,volcano:Mountain,drought:Sun,landslide:Mountain,storm:Wind,snow_ice:Snowflake,dust:CloudFog,temperature_extreme:Thermometer,water_color:Waves,other:Globe2};
export default function MySkywatch({account,catalog=SPACE_OBJECTS,tab='satellite',onTab}) {
  const [query,setQuery]=useState('');
  const {state,owner}=account,followed=state.subscriptions||[],satellites=followed.filter(row=>row.kind==='satellite');
  const disabled=state.subscriptionPhase!=='ready'||Boolean(state.alertBusy);
  const chosen=(kind,target)=>followed.some(row=>row.kind===kind&&row.target_id===target);
  const tabs=[{id:'satellite',label:'Satellites',icon:Satellite},{id:'celestial',label:'Planets / Moon',icon:Moon},{id:'event',label:'Events',icon:Activity},{id:'locations',label:'Locations',icon:MapPin}];
  function followButton(kind,target,label) {
    const active=chosen(kind,target),pending=state.alertBusy===`${kind}:${target}`;
    return <button type="button" className={`sky-follow ${active?'is-following':''}`} aria-label={`${active?'Unfollow':'Follow'} ${label}`} aria-pressed={active} disabled={disabled||kind==='satellite'&&!active&&satellites.length>=20} onClick={()=>owner.toggleTarget(kind,target)}>{active?<Check size={13}/>:<Orbit size={13}/>}<span>{pending?'Saving…':active?'Following':'Follow'}</span></button>;
  }
  const matches=satelliteMatches(catalog,query);
  return <div className="skywatch">
    <div className="account-feature-intro"><Orbit size={22}/><div><strong>My Skywatch</strong><p>Your private observing list. Following is for future alerts; globe tracking is controlled separately.</p></div></div>
    <AccountTabs id="skywatch" label="Skywatch collections" tabs={tabs} value={tab} onChange={onTab}/>
    {state.subscriptionError&&<p className="account-inline-error" role="alert">{state.subscriptionError}<button type="button" onClick={()=>owner.loadSubscriptions(true)}>Retry</button></p>}
    {state.subscriptionPhase==='loading'&&<p role="status" className="account-muted">Loading your skywatch…</p>}
    <div role="tabpanel" id={`skywatch-${tab}-panel`} aria-labelledby={`skywatch-${tab}-tab`}>
      {tab==='satellite'&&<>
        <div className="account-section-title"><h3>Satellite watchlist</h3><span>{satellites.length}/20</span></div>
        <label className="sky-search"><Search size={16}/><span className="sr-only">Search Live satellites</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Name or NORAD ID" maxLength={100}/></label>
        <p className="account-muted">{catalog.length} Live catalog objects · {matches.length} {query?'matches':'available'}</p>
        {satellites.length>0&&!query&&<details className="sky-followed" open><summary>Following · {satellites.length}</summary><ul className="sky-satellite-list">{satellites.map(row=><li key={row.id}><Satellite size={17}/><div><strong title={row.target_name}>{row.target_name}</strong><small>NORAD {row.target_id}</small></div>{followButton('satellite',row.target_id,row.target_name)}</li>)}</ul></details>}
        {!satellites.length&&state.subscriptionPhase==='ready'&&<p className="sky-empty">No satellites followed yet. Search the Live catalog to build your watchlist.</p>}
        {satellites.length>=20&&<p className="account-muted">Your 20 satellite slots are full. Unfollow one to add another.</p>}
        <ul className="sky-satellite-list sky-results" aria-label="Satellite search results">{matches.slice(0,query?10:6).map(row=><li key={row.noradId}><span className="sky-satellite-symbol"><Satellite size={18}/></span><div><strong title={row.name}>{row.name}</strong><small>{row.category} · NORAD {row.noradId}</small></div>{followButton('satellite',String(row.noradId),row.name)}</li>)}</ul>
        {query&&!matches.length&&<p className="sky-empty">No matching Live catalog object. Try a name or a NORAD ID.</p>}
      </>}
      {tab==='celestial'&&<><div className="account-section-title"><h3>Planets & Moon</h3><span>{followed.filter(row=>row.kind==='celestial').length}/8</span></div>
        <div className="sky-object-grid">{PLANETS.map(id=>{const body=CELESTIAL_BODIES[id],active=chosen('celestial',id);return <button type="button" key={id} className={`sky-object-tile ${active?'is-following':''}`} aria-label={`${active?'Unfollow':'Follow'} ${body.name}`} aria-pressed={active} disabled={disabled} onClick={()=>owner.toggleTarget('celestial',id)}>
          <span className={`sky-object-orb is-${id}`} style={{'--body-color':body.color}}><img src={body.texture} alt="" loading="lazy"/></span><strong>{body.name}</strong><small>{state.alertBusy===`celestial:${id}`?'Saving…':active?'Following':'Follow'}</small>{active&&<Check className="sky-tile-check" size={14}/>}</button>;})}</div><p className="account-muted">Earth-based observation interests. Visibility predictions are upcoming.</p></>}
      {tab==='event'&&<><div className="account-section-title"><h3>Natural-event interests</h3><span>{followed.filter(row=>row.kind==='event').length} selected</span></div><div className="sky-event-grid">{Object.entries(EVENT_CATEGORIES).map(([id,spec])=>{const Icon=ICONS[id],active=chosen('event',id);return <button type="button" key={id} className={`sky-event-tile ${active?'is-following':''}`} style={{'--event-color':spec.color}} aria-label={`${active?'Unfollow':'Follow'} ${spec.label}`} aria-pressed={active} disabled={disabled} onClick={()=>owner.toggleTarget('event',id)}><Icon size={20}/><span>{spec.label}</span>{active&&<Check size={13}/>}</button>;})}</div><p className="account-muted">Future alerts depend on saved locations, your radius, genuine source reports, event severity, confidence, freshness and alert eligibility. A reported event does not automatically mean current danger.</p></>}
      {tab==='locations'&&<AccountNotificationSettings account={account} section="locations"/>}
    </div>
    {tab!=='locations'&&<p className="account-upcoming"><span/>Watchlists are active. Predictions and alert delivery are upcoming.</p>}
  </div>;
}
