import {TIME_OBJECTS} from '../data/timeExplorerCatalog.js';
import {historicalAvailability} from '../services/timeSatelliteAvailability.js';
import {useState} from 'react';
import MobileCatalog from './MobileCatalog.jsx';

export default function HistoricalSatelliteList({open,onClose,time,coverage,historicalData,trackedIds,onToggle,onSelect,selectedId}) {
  const [query,setQuery]=useState(''),[onlyEnabled,setOnlyEnabled]=useState(false),[draftEnabled,setDraftEnabled]=useState(false);
  const rows=TIME_OBJECTS.filter(row=>(!onlyEnabled||trackedIds.includes(row.noradId))&&`${row.name} ${row.noradId}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <MobileCatalog open={open} onClose={onClose} label="historical satellites" title="Historical satellites" count={15} query={query} onQuery={setQuery} filterCount={Number(onlyEnabled)} onApply={()=>setOnlyEnabled(draftEnabled)} onClear={()=>{setOnlyEnabled(false);setDraftEnabled(false);}} filters={<label><input type="checkbox" checked={draftEnabled} onChange={e=>setDraftEnabled(e.target.checked)}/> Enabled only</label>} footer={<span>{trackedIds.length}/15 enabled · {rows.length} results</span>}>
   <p>{time.toISOString().slice(0,16).replace('T',' ')} UTC · Archived elements within 24 hours only.</p>
   {rows.map(row=>{const status=historicalAvailability(row.noradId,time,coverage,historicalData),checked=trackedIds.includes(row.noradId),available=checked&&historicalData?.objects?.some(o=>o.norad_id===row.noradId);return <article className={`mobile-object-row ${selectedId===row.noradId?'is-selected':''}`} key={row.noradId}>
    <label className="mobile-object-select"><input type="checkbox" checked={checked} disabled={Boolean(status.disabled)} aria-label={`Show historical ${row.name}`} onChange={()=>onToggle(row.noradId,!checked)}/></label><button className="mobile-object-name" disabled={!available} onClick={()=>onSelect(row.noradId)}><strong>{row.name}</strong><small>NORAD {row.noradId} · {checked?'Enabled':'Disabled'}</small><span>{status.label}</span></button><small className="mobile-object-actions">{status.reason}</small>
   </article>;})}
  </MobileCatalog>;
}
