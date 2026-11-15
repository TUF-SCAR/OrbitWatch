import {AnimatePresence} from 'motion/react';
import {Satellite,X} from 'lucide-react';
import ResponsivePanel from './ResponsivePanel.jsx';
import {TIME_OBJECTS} from '../data/timeExplorerCatalog.js';
import {historicalAvailability} from '../services/timeSatelliteAvailability.js';
import {useState} from 'react';
import {usePhoneUI} from '../utils/usePhoneUI.js';
import MobileCatalog from './MobileCatalog.jsx';

export default function HistoricalSatelliteList({open,onClose,time,coverage,historicalData,trackedIds,onToggle,onSelect,selectedId}) {
  const phone=usePhoneUI(),[query,setQuery]=useState(''),[onlyEnabled,setOnlyEnabled]=useState(false),[draftEnabled,setDraftEnabled]=useState(false);
  const rows=TIME_OBJECTS.filter(row=>(!onlyEnabled||trackedIds.includes(row.noradId))&&`${row.name} ${row.noradId}`.toLowerCase().includes(query.trim().toLowerCase()));
  if(phone)return <MobileCatalog open={open} onClose={onClose} label="historical satellites" title="Historical satellites" count={15} query={query} onQuery={setQuery} filterCount={Number(onlyEnabled)} onApply={()=>setOnlyEnabled(draftEnabled)} onClear={()=>{setOnlyEnabled(false);setDraftEnabled(false);}} filters={<label><input type="checkbox" checked={draftEnabled} onChange={e=>setDraftEnabled(e.target.checked)}/> Enabled only</label>} footer={<span>{trackedIds.length}/15 enabled · {rows.length} results</span>}>
   <p>{time.toISOString().slice(0,16).replace('T',' ')} UTC · Archived elements within 24 hours only.</p>
   {rows.map(row=>{const status=historicalAvailability(row.noradId,time,coverage,historicalData),checked=trackedIds.includes(row.noradId),available=checked&&historicalData?.objects?.some(o=>o.norad_id===row.noradId);return <article className={`mobile-object-row ${selectedId===row.noradId?'is-selected':''}`} key={row.noradId}>
    <label className="mobile-object-select"><input type="checkbox" checked={checked} disabled={Boolean(status.disabled)} aria-label={`Show historical ${row.name}`} onChange={()=>onToggle(row.noradId,!checked)}/></label><button className="mobile-object-name" disabled={!available} onClick={()=>onSelect(row.noradId)}><strong>{row.name}</strong><small>NORAD {row.noradId} · {checked?'Enabled':'Disabled'}</small><span>{status.label}</span></button><small className="mobile-object-actions">{status.reason}</small>
   </article>;})}
  </MobileCatalog>;
  return <AnimatePresence>{open&&<ResponsivePanel onDismiss={onClose} as="aside" side="left" strength={3} className="object-explorer historical-satellite-list hud-panel hud-panel--left" aria-label="Historical satellite catalog">
    <header className="object-explorer__head hud-panel__header"><div><span className="eyebrow">PERMANENT TIME CATALOG / 15 OBJECTS</span><h2><Satellite size={18}/> Historical satellites</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close historical satellites"><X size={18}/></button></header>
    <div className="hud-panel__body"><p className="account-muted">{time.toISOString().replace('T',' ').slice(0,19)} UTC. Enable objects individually. Only archived elements within 24 hours are used.</p>
      <ul>{TIME_OBJECTS.map(row=>{const status=historicalAvailability(row.noradId,time,coverage,historicalData),checked=trackedIds.includes(row.noradId);return <li key={row.noradId} data-status={status.state}>
        <label><input type="checkbox" checked={checked} disabled={Boolean(status.disabled)} aria-label={`Show historical ${row.name}`} onChange={()=>onToggle(row.noradId,!checked)}/><span><strong>{row.name}</strong><small>NORAD {row.noradId}</small></span></label>
        <span className="historical-status">{checked&&historicalData?.state==='loading'?'Checking archived elements…':status.label}</span><small>{status.reason}</small>
        {checked&&historicalData?.objects?.some(item=>item.norad_id===row.noradId)&&<button type="button" aria-pressed={selectedId===row.noradId} onClick={()=>onSelect(row.noradId)}>Inspect historical position</button>}
      </li>;})}</ul>
    </div><footer className="hud-panel__footer">{trackedIds.length}/15 enabled · Coverage is separate from verified lifetime.</footer>
  </ResponsivePanel>}</AnimatePresence>;
}
