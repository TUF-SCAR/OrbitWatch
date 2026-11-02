import NotificationDelivery from './NotificationDelivery.jsx';
import {useState} from 'react';
import './AccountNotificationSettings.css';

function ZoneInput({id,value,onChange,required=false}) {
  return <><input id={id} type="text" maxLength={64} list="account-iana-zones" placeholder="e.g. Asia/Kolkata" value={value||''} onChange={event=>onChange(event.target.value)} required={required}/><small>Enter the IANA timezone for this location. It is never inferred from coordinates.</small></>;
}
const zones=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[];

export default function AccountNotificationSettings({account,section='all'}) {
  const {state,owner}=account,[removing,setRemoving]=useState(null);
  const {locations,preferences,preferenceDraft:form,locationDraft:draft,busy,phase}=state;
  const ready=phase==='ready',disabled=busy||!ready;
  return <div className="account-foundation" aria-busy={busy||phase==='loading'}>
    <datalist id="account-iana-zones">{zones.map(zone=><option value={zone} key={zone}/>)}<option value="UTC"/></datalist>
    <p className="account-foundation__intro">Notifications require enabled categories, followed targets and saved locations. Quiet hours suppress all categories. Browser push needs separate permission.</p>
    {phase==='loading'&&<p role="status">Loading saved account settings…</p>}
    {state.error&&<p className="account-foundation__error" role="alert">{state.error}</p>}
    {state.notice&&<p role="status">{state.notice}</p>}
    {(phase==='error'||phase==='unavailable'||state.conflict)&&<button type="button" disabled={busy||phase==='loading'} onClick={()=>owner.load(true)}>{state.conflict?'Reload saved versions (keep edits)':'Retry loading account settings'}</button>}
    {section!=='preferences'&&<section className="profile-panel__section" aria-labelledby="account-locations-title">
      <h3 id="account-locations-title">Saved observation locations</h3>
      <p>Save up to five locations deliberately. Clicking the globe never saves one.</p>
      {ready&&!locations.length&&<p>No saved locations yet.</p>}
      <ul className="account-locations">{locations.map(row=><li key={row.id}>
        <strong>{row.name}{row.is_default&&<small> · Default</small>}</strong>
        <span>{row.latitude.toFixed(6)}°, {row.longitude.toFixed(6)}°</span><span>{row.timezone}</span>
        <div className="account-actions"><button type="button" disabled={disabled} onClick={()=>owner.editLocation(row)} aria-label={`Edit ${row.name}`}>Edit</button>
          {!row.is_default&&<button type="button" disabled={disabled} onClick={()=>owner.makeDefault(row)} aria-label={`Make ${row.name} default`}>Make default</button>}
          <button type="button" disabled={disabled} onClick={()=>setRemoving(row.id)} aria-label={`Remove ${row.name}`}>Remove</button></div>
        {removing===row.id&&<div className="account-remove"><p>Remove {row.name}? If it is the default, the oldest remaining saved location becomes the default. Removing the last location disables quiet hours that use its timezone.</p><button type="button" disabled={disabled} onClick={async()=>{await owner.removeLocation(row);setRemoving(null);}}>Confirm remove</button><button type="button" disabled={busy} onClick={()=>setRemoving(null)}>Keep location</button></div>}
      </li>)}</ul>
      {!draft&&<button type="button" disabled={disabled||locations.length>=5} onClick={()=>owner.startNew()}>Add location</button>}
      {draft&&<form className="account-form" aria-label={draft.id?'Edit observation location':'Add observation location'} onSubmit={event=>{event.preventDefault();owner.saveLocation();}}>
        <fieldset disabled={disabled}><legend>{draft.id?'Edit location':'Add location'}</legend>
          <label htmlFor="account-location-name">Location name</label><input id="account-location-name" maxLength={80} required value={draft.name} onChange={event=>owner.changeLocation({name:event.target.value})}/>
          <div className="account-coordinate-row"><div><label htmlFor="account-latitude">Latitude</label><input id="account-latitude" type="number" step="0.000001" min="-90" max="90" required value={draft.latitude} onChange={event=>owner.changeLocation({latitude:event.target.value})}/></div>
            <div><label htmlFor="account-longitude">Longitude</label><input id="account-longitude" type="number" step="0.000001" min="-180" max="180" required value={draft.longitude} onChange={event=>owner.changeLocation({longitude:event.target.value})}/></div></div>
          <label htmlFor="account-location-zone">Location timezone</label><ZoneInput id="account-location-zone" value={draft.timezone} onChange={timezone=>owner.changeLocation({timezone})} required/>
          <label className="account-toggle"><input type="checkbox" checked={draft.is_default} disabled={Boolean(draft.id&&locations.find(row=>row.id===draft.id)?.is_default)} onChange={event=>owner.changeLocation({is_default:event.target.checked})}/> Use as default</label>
          <p>The first saved location becomes your default. Coordinates are saved to six decimal places.</p>
          {!draft.id&&locations.length>=5&&<p>Five locations are already saved. Remove one before saving this point.</p>}
          <div className="account-actions"><button type="submit" disabled={!draft.id&&locations.length>=5}>{busy?'Saving…':'Save location'}</button><button type="button" onClick={()=>owner.cancelLocation()}>Cancel edit</button></div>
        </fieldset>
      </form>}
    </section>}
    {section!=='locations'&&<NotificationDelivery account={account}/>}
    {section!=='locations'&&<section className="profile-panel__section" aria-labelledby="account-preferences-title"><h3 id="account-preferences-title">Notification preferences</h3>
      {form&&<form className="account-form" aria-label="Notification preferences" onSubmit={event=>{event.preventDefault();owner.savePreferences();}}><fieldset disabled={disabled}>
        <legend className="sr-only">Alert preferences</legend>
        {[['notifications_enabled','Enable notifications'],['satellite_alerts','Satellite visibility alerts'],['celestial_alerts','Planet / Moon viewing alerts'],['natural_event_alerts','Natural-event alerts']].map(([key,label])=><label className="account-toggle" key={key}><input type="checkbox" checked={form[key]} onChange={event=>owner.changePreference({[key]:event.target.checked})}/>{label}</label>)}
        <label htmlFor="account-advance">Advance warning</label><select id="account-advance" value={form.advance_warning_minutes} onChange={event=>owner.changePreference({advance_warning_minutes:Number(event.target.value)})}>{[10,30,60].map(value=><option key={value} value={value}>{value} minutes</option>)}</select>
        <label htmlFor="account-radius">Natural-event relevance radius (km)</label><input id="account-radius" type="number" min="1" max={preferences.max_event_radius_km} step="1" required value={form.event_radius_km} onChange={event=>owner.changePreference({event_radius_km:event.target.value===''?'':Number(event.target.value)})}/><small>Maximum {preferences.max_event_radius_km} km.</small>
        <label className="account-toggle"><input type="checkbox" checked={form.quiet_hours_enabled} onChange={event=>owner.changePreference({quiet_hours_enabled:event.target.checked})}/> Quiet hours</label>
        {form.quiet_hours_enabled&&<>
          <label htmlFor="account-quiet-start">Quiet hours start</label><input id="account-quiet-start" type="time" required value={form.quiet_start||''} onChange={event=>owner.changePreference({quiet_start:event.target.value})}/>
          <label htmlFor="account-quiet-end">Quiet hours end</label><input id="account-quiet-end" type="time" required value={form.quiet_end||''} onChange={event=>owner.changePreference({quiet_end:event.target.value})}/>
          <label htmlFor="account-quiet-source">Quiet-hours timezone</label><select id="account-quiet-source" value={form.quiet_timezone_mode} onChange={event=>owner.changePreference({quiet_timezone_mode:event.target.value,quiet_timezone:null})}><option value="default_location">Default saved location</option><option value="explicit">Choose an explicit timezone</option></select>
          {form.quiet_timezone_mode==='explicit'?<><label htmlFor="account-quiet-zone">Explicit quiet-hours timezone</label><ZoneInput id="account-quiet-zone" value={form.quiet_timezone} onChange={quiet_timezone=>owner.changePreference({quiet_timezone})} required/></>:<p>{locations.find(row=>row.is_default)?.timezone||'Save a default location, or choose an explicit timezone.'}</p>}
          <small>Overnight quiet hours can be saved. The worker uses this timezone, including daylight-saving transitions.</small>
        </>}
        <button type="submit">{busy?'Saving…':'Save alert preferences'}</button><small>Preferences are stored for this account. Actual worker and browser delivery status is shown above.</small>
      </fieldset></form>}
    </section>}
  </div>;
}
