import {AnimatePresence} from 'motion/react';
import {Satellite,X} from 'lucide-react';
import SpatialSurface from './SpatialSurface.jsx';
import {TIME_OBJECTS} from '../data/timeExplorerCatalog.js';
import {historicalAvailability} from '../services/timeSatelliteAvailability.js';

export default function HistoricalSatelliteList({open,onClose,time,coverage,historicalData,trackedIds,onToggle,onSelect,selectedId}) {
  return <AnimatePresence>{open&&<SpatialSurface as="aside" side="left" strength={3} className="object-explorer historical-satellite-list hud-panel hud-panel--left" aria-label="Historical satellite catalog">
    <header className="object-explorer__head hud-panel__header"><div><span className="eyebrow">PERMANENT TIME CATALOG / 15 OBJECTS</span><h2><Satellite size={18}/> Historical satellites</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close historical satellites"><X size={18}/></button></header>
    <div className="hud-panel__body"><p className="account-muted">{time.toISOString().replace('T',' ').slice(0,19)} UTC. Enable objects individually. Only archived elements within 24 hours are used.</p>
      <ul>{TIME_OBJECTS.map(row=>{const status=historicalAvailability(row.noradId,time,coverage,historicalData),checked=trackedIds.includes(row.noradId);return <li key={row.noradId} data-status={status.state}>
        <label><input type="checkbox" checked={checked} disabled={Boolean(status.disabled)} aria-label={`Show historical ${row.name}`} onChange={()=>onToggle(row.noradId,!checked)}/><span><strong>{row.name}</strong><small>NORAD {row.noradId}</small></span></label>
        <span className="historical-status">{checked&&historicalData?.state==='loading'?'Checking archived elements…':status.label}</span><small>{status.reason}</small>
        {checked&&historicalData?.objects?.some(item=>item.norad_id===row.noradId)&&<button type="button" aria-pressed={selectedId===row.noradId} onClick={()=>onSelect(row.noradId)}>Inspect historical position</button>}
      </li>;})}</ul>
    </div><footer className="hud-panel__footer">{trackedIds.length}/15 enabled · Coverage is separate from verified lifetime.</footer>
  </SpatialSurface>}</AnimatePresence>;
}
