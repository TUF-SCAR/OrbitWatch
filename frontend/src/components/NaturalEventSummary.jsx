import { BookOpen, Crosshair, Layers3, RotateCcw, X } from 'lucide-react';
import { EVENT_CATEGORIES } from '../data/eventCategories.js';
import { eventIcon } from '../services/naturalEventArt.js';
import './NaturalEvents.css';

function eventTime(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Time unavailable';
}

export default function NaturalEventSummary({ group, report, cluster, focused, onDetails, onFocus, onReturn, onClose }) {
  const category = report && (EVENT_CATEGORIES[report.category] || EVENT_CATEGORIES.other);
  const hasGeometry = group?.position || group?.path || group?.forecast
    || ['Polygon', 'MultiPolygon'].includes(report?.geometry?.type) || report?.boundaries?.length;
  if (!report && !cluster) return null;
  const anchor = group?.anchor;
  const positionSource = anchor?.report.provider || report?.provider;
  return (
    <aside className="event-summary" aria-label={cluster ? 'Nearby reported events' : 'Selected natural event'}
      style={{ '--event-accent': category?.color || '#9bdbde' }}>
      <div className="event-summary__main">
        {category ? <img src={eventIcon(report.category)} alt="" width="46" height="46" /> : <Layers3 size={28} aria-hidden="true" />}
        <div className="event-summary__title" aria-live="polite">
          <small>{category ? category.label : 'Map cluster'}{report?.data_state === 'stale' ? ' · Stale cache' : ''}</small>
          <strong>{cluster ? `${cluster.length} nearby events` : group?.report.title || report.title}</strong>
        </div>
        <button type="button" className="event-summary__close" aria-label="Dismiss event selection" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>
      <p>{cluster ? 'Open the list to inspect individual reports.'
        : `${positionSource.toUpperCase()}${positionSource === 'gdacs' && report.category === 'cyclone' && anchor ? ' centroid' : ''} · ${eventTime(anchor ? new Date(anchor.at).toISOString() : report.last_report_at || report.reported_at)}`}</p>
      <div className="event-summary__actions">
        <button type="button" onClick={onDetails}><BookOpen size={16} aria-hidden="true" />{cluster ? 'View reports' : 'Details'}</button>
        {focused ? <button type="button" onClick={onReturn}><RotateCcw size={16} aria-hidden="true" />Previous view</button>
          : !cluster && <button type="button" onClick={onFocus} disabled={!hasGeometry}><Crosshair size={16} aria-hidden="true" />Focus</button>}
      </div>
    </aside>
  );
}
