import { useEffect, useState } from 'react';
import { ArrowLeft, Crosshair, ExternalLink } from 'lucide-react';
import { EVENT_CATEGORIES } from '../data/eventCategories.js';
import { eventFilter, forecastCone, trackPoints } from '../services/cycloneTracks.js';
import { eventIcon } from '../services/naturalEventArt.js';
import { EVENT_STATUS_LABELS, eventLabel, eventStatus, isLiveEvent } from '../services/naturalEventPresentation.js';
import './NaturalEvents.css';

function time(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Unavailable';
}

function sourceUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function SourceLink({ url, children }) {
  const href = sourceUrl(url);
  return href && <a className="event-report-link" href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={14} aria-hidden="true" /></a>;
}

function CycloneTrack({ group, report, clock, forecastOn, onForecast, coneOn, onCone }) {
  const observedTrack = group?.path?.track || report.track;
  const forecastTrack = group?.forecast?.track || report.track;
  const observed = trackPoints(observedTrack, 'observed', clock);
  const forecast = trackPoints(forecastTrack, 'forecast', clock);
  const cone = forecastCone(forecastTrack, clock);
  const latest = observed.at(-1);
  return (
    <section className="cyclone-track-details" aria-label="Cyclone trajectory">
      <h3>Cyclone trajectory</h3>
      {observed.length > 1 ? <>
        <div className="cyclone-track-legend"><span><i />Reported positions</span><span><i />Official forecast</span></div>
        <p>{observed.length} reported positions · {time(observed[0].at)} → {time(latest.at)}</p>
        <p className="weather-source">{observedTrack.source} · {observedTrack.official_id}{observedTrack.basin ? ` · ${observedTrack.basin} ${observedTrack.season}` : ''}</p>
      </> : <p>No validated observed path is available for this storm.</p>}
      {forecast.length > 0 ? <>
        <p>Official forecast · {time(forecast[0].at)} → {time(forecast.at(-1).at)}</p>
        <p className="weather-source">Issued {time(forecastTrack.issued_at)} · Expires {time(forecastTrack.expires_at)}. Forecast passage is uncertain.</p>
        <SourceLink url={forecastTrack.forecast_source_url || forecastTrack.source_url}>Official forecast source</SourceLink>
        <label className="weather-toggle"><input type="checkbox" checked={forecastOn} onChange={e => onForecast(e.target.checked)} />Show forecast path</label>
        {cone ? <>
          <label className="weather-toggle"><input type="checkbox" checked={coneOn && forecastOn} disabled={!forecastOn} onChange={e => onCone(e.target.checked)} />Show official center uncertainty cone</label>
          <p className="weather-source">The cone describes uncertainty in the center’s future position. Storm hazards can extend beyond it.</p>
          <SourceLink url={cone.source_url}>Official cone · {time(cone.issued_at)}</SourceLink>
        </> : <p className="weather-source">No verified cone is available for this advisory.</p>}
      </> : <p className="weather-source">No current verified forecast available.</p>}
      {observed.length + forecast.length > 0 && <details><summary>Dated track positions</summary>
        <ol className="event-timeline">{[...observed.map(point => ({ point, kind: 'Reported' })), ...forecast.map(point => ({ point, kind: 'Forecast' }))].map(({ point, kind }) =>
          <li key={`${kind}:${point.at}`}>{kind} · {time(point.at)} · {point.latitude.toFixed(2)}°, {point.longitude.toFixed(2)}°{Number.isFinite(point.wind) ? ` · ${point.wind} ${point.wind_units} (${point.wind_averaging_minutes || '?'} min)` : ''}{point.agency ? ` · ${point.agency}` : ''}</li>)}</ol>
        <p className="weather-source">{observedTrack?.note} Lines connect supplied positions and skip gaps. Point colors encode intensity only when the source provides the one-minute wind convention.</p>
        <SourceLink url={observedTrack?.source_url}>Observed track source</SourceLink>
      </details>}
    </section>
  );
}

function ReportDetails({ report, group, clock, data, onFocus, onReturn, onSelect, forecast, onForecast, cone, onCone }) {
  const category = EVENT_CATEGORIES[report.category] || EVENT_CATEGORIES.other;
  const stamp = report.last_report_at || report.reported_at;
  const age = Number.isFinite(Date.parse(stamp)) ? `${Math.max(0, Math.floor((clock - Date.parse(stamp)) / 3600000))} h` : 'Unavailable';
  const measurements = report.measurements || [];
  const evidence = group?.status || eventStatus(report, clock);
  const canFocus = group?.position || group?.path || trackPoints(group?.forecast?.track || report.track, 'forecast', clock).length
    || ['Polygon', 'MultiPolygon'].includes(report.geometry?.type) || report.boundaries?.length;
  return (
    <section className="event-inspector" aria-label="Selected natural event" style={{ '--event-accent': category.color }}>
      <button className="secondary-action event-back" type="button" onClick={() => { onReturn?.(); onSelect(null); }}><ArrowLeft size={16} aria-hidden="true" />Reports</button>
      <div className="event-report-heading">
        <img src={eventIcon(report.category)} alt="" width="60" height="60" />
        <div><span>{category.label} · {report.provider.toUpperCase()}</span><h3>{report.title}</h3></div>
      </div>
      <p className="event-report-status"><strong>{EVENT_STATUS_LABELS[evidence.state]}</strong>{evidence.classification ? ` · ${evidence.classification}` : ''} · {time(evidence.at || stamp)}</p>
      <SourceLink url={evidence.source_url}>{evidence.agency || 'Status evidence'}</SourceLink>
      <div className="event-actions">
        <button className="primary-action" type="button" disabled={!canFocus} onClick={() => onFocus?.(report.id)}><Crosshair size={16} aria-hidden="true" /> Focus on globe</button>
        <SourceLink url={report.source_url}>Source report</SourceLink>
      </div>
      {report.description && <p className="weather-source">{report.description}</p>}
      {group?.reports.length > 1 && <div className="event-linked-reports">
        <strong>{group.reports.length} verified reports · one map marker</strong>
        <p className="weather-source">Latest mapped position from {group.anchor?.report.provider.toUpperCase() || 'no observed anchor'}{group.anchor ? ` · ${time(group.anchor.at)}` : ''}.</p>
        <div>{group.reports.map(item => <button type="button" className="secondary-action" key={item.id}
          aria-pressed={item.id === report.id} onClick={() => onSelect(item.id)}>{item.provider.toUpperCase()}</button>)}</div>
      </div>}
      {report.category === 'cyclone' && <CycloneTrack group={group} report={report} clock={clock} forecastOn={forecast} onForecast={onForecast} coneOn={cone} onCone={onCone} />}
      {report.provider === 'gdacs' && <div className="event-boundary-action">
        <button type="button" className="secondary-action" disabled={data.boundaryStatus?.id === report.id && data.boundaryStatus.state === 'loading'}
          onClick={() => data.loadBoundary?.(report.id)}>Load official boundaries</button>
        {data.boundaryStatus?.id === report.id && <p className="weather-source" role="status">{data.boundaryStatus.state === 'loading' ? 'Loading source geometry…' : data.boundaryStatus.message}</p>}
        <p className="weather-source">A published boundary may describe a forecast or impact product.</p>
      </div>}
      <details className="event-metadata"><summary>Scientific details and source status</summary>
        <p className="weather-source">{report.position ? `${report.position[1].toFixed(3)}°, ${report.position[0].toFixed(3)}° · ` : ''}{report.position_meaning}</p>
        <dl className="event-facts">
          <div><dt>Source identity</dt><dd>{report.provider_event_id}</dd></div>
          <div><dt>First report or start</dt><dd>{time(report.started_at)}</dd></div>
          <div><dt>Last report</dt><dd>{time(stamp)} · {age}</dd></div>
          <div><dt>Source modification</dt><dd>{time(report.source_updated_at || report.updated_at)}</dd></div>
          <div><dt>Verified material change</dt><dd>{report.material_update ? `${report.material_update.kind.replaceAll('_', ' ')} · ${time(report.material_update.at)}` : 'Unavailable'}</dd></div>
          <div><dt>Overall source status</dt><dd>{report.status || 'Unavailable'}</dd></div>
          {report.episode_status && <div><dt>Episode alert</dt><dd>Episode {report.source_episode_id} · {report.episode_status}</dd></div>}
          {!measurements.length && <div><dt>Quantified intensity</dt><dd>Not supplied</dd></div>}
          {measurements.map((item, index) => <div key={index}><dt>{item.label}</dt><dd>{item.value} {item.units || ''}{item.description && <small>{item.description}</small>}</dd></div>)}
        </dl>
        <p className="weather-source">{report.status_meaning} A recent report or open record does not independently verify ongoing activity. Selection animation and symbol size are illustrative.</p>
        {['Polygon', 'MultiPolygon'].includes(report.geometry?.type) && <p className="weather-source">Published boundaries retain their rings and components. No center or danger area is inferred.</p>}
        <p className="weather-source">Retrieved {time(report.retrieved_at)} · Source validated {time(report.provider_validated_at)}. These are cache timestamps.</p>
        {report.related_ids?.length > 0 && <p className="weather-source">Source references: {report.related_ids.join(', ')}</p>}
        {(report.references || []).map((ref, index) => <SourceLink key={index} url={ref.url}>{ref.provider || 'Source reference'}</SourceLink>)}
      </details>
    </section>
  );
}

export default function NaturalEventsPanel({ data, enabled, onEnabled, category, onCategory, selectedId, onSelect,
  onFocus, onReturn, cluster, onClearCluster, archive, onArchive, forecast, onForecast, cone, onCone }) {
  const [filter, setFilter] = useState({ provider: 'all', status: 'all', limit: 40 });
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const selected = data.events.find(event => event.id === selectedId);
  const display = data.display?.reportGroups;
  const clusterKeys = cluster && new Set(cluster.map(id => display?.get(id)?.id || id));
  const candidates = data.events.filter(event => {
    const group = display?.get(event.id);
    return (archive || isLiveEvent(group || {})) && (!clusterKeys || clusterKeys.has(group?.id || event.id));
  });
  const events = eventFilter(candidates, { category, provider: filter.provider, status: filter.status, now: clock });
  const categories = new Set(candidates.map(event => event.category));
  function change(key, value) { setFilter(previous => ({ ...previous, [key]: value, limit: key === 'limit' ? value : 40 })); }

  return <div className="natural-events">
    <label className="weather-toggle"><input type="checkbox" checked={enabled} onChange={e => onEnabled(e.target.checked)} /><span>Show live events on the globe</span></label>
    <div className="weather-view-tabs event-context-tabs" role="group" aria-label="Natural Events context">
      <button type="button" aria-pressed={!archive} onClick={() => onArchive(false)}>Live events</button>
      <button type="button" aria-pressed={archive} onClick={() => onArchive(true)}>Report archive</button>
    </div>
    <label className="weather-field-picker">Event category<select aria-label="Event category" value={category} onChange={e => { onReturn?.(); onCategory(e.target.value); change('limit', 40); }}>
      <option value="all">All reported categories</option>{Object.entries(EVENT_CATEGORIES).map(([key, item]) => <option value={key} key={key}>{item.label}{categories.has(key) ? '' : ' · no reports'}</option>)}</select></label>
    {selected ? <ReportDetails report={selected} group={display?.get(selected.id)} clock={clock} data={data} onFocus={onFocus} onReturn={onReturn} onSelect={onSelect}
      forecast={forecast} onForecast={onForecast} cone={cone} onCone={onCone} /> : <>
      {cluster && <div className="event-cluster-banner"><strong>{cluster.length} nearby events</strong><button type="button" className="secondary-action" onClick={onClearCluster}>Show all reports</button></div>}
      <div className="event-filters" aria-label="Report list filters">
        <label>Source<select aria-label="Event source" value={filter.provider} onChange={e => change('provider', e.target.value)}><option value="all">All sources</option>{Object.keys(data.providers).map(provider => <option key={provider} value={provider}>{provider.toUpperCase()}</option>)}</select></label>
        <label>Report context<select aria-label="Event report context" value={filter.status} onChange={e => change('status', e.target.value)}><option value="all">All loaded reports</option><option value="recent">Reported in 7 days</option><option value="older">Older source reports</option><option value="tracks">Cyclone tracks</option><option value="fresh">Fresh cache</option><option value="stale">Stale cache</option></select></label>
      </div>
      <div className="weather-section-heading"><h3>{archive ? 'Archived reports' : 'Verified live events'}</h3><span>{events.length} / {candidates.length} reports</span></div>
      {data.state === 'preparing' && <p role="status">Loading official event feeds…</p>}
      {['offline', 'unavailable'].includes(data.state) && <p className="inline-warning" role="status">Event feeds unavailable. Retained reports keep their original timestamps.</p>}
      {events.length === 0 && data.state !== 'preparing' && <p role="status">{archive ? 'No loaded reports match these filters.' : 'No verified live events match these filters. The archive retains other reports.'}</p>}
      {data.coverage?.truncated && <p className="weather-source">Showing a bounded subset of {data.coverage.normalized_reports} reports. Feed coverage is incomplete.</p>}
      <ul className="event-list">{events.slice(0, filter.limit).map(event =>
        <li key={event.id}><button type="button" onClick={() => { onEnabled(true); onSelect(event.id); }}>
          <img src={eventIcon(event.category)} alt="" width="43" height="43" loading="lazy" />
          <span><strong>{eventLabel(event, display?.get(event.id)?.status)}</strong><small>{event.provider.toUpperCase()} · {time(event.last_report_at || event.reported_at)}</small>
            <small>{EVENT_STATUS_LABELS[(display?.get(event.id)?.status || eventStatus(event, clock)).state]}{event.data_state === 'stale' ? ' · Stale cache' : ''}{(display?.get(event.id)?.reports.length || 0) > 1 ? ' · Linked storm' : ''}</small></span>
        </button></li>)}</ul>
      {events.length > filter.limit && (filter.limit < 200
        ? <button type="button" className="secondary-action event-more" onClick={() => change('limit', Math.min(200, filter.limit + 40))}>Show more reports</button>
        : <p className="weather-source">Refine the filters to inspect more than 200 reports.</p>)}
    </>}
    <details><summary>Providers and reporting limits</summary>
      {Object.entries(data.providers).map(([provider, item]) => <div className="event-provider" key={provider}>
        <strong>{provider.toUpperCase()} · {item.state.toUpperCase()}</strong><p>{item.limitation}</p>
        <p>{item.count} reports · Retrieved {time(item.retrieved_at)} · Validated {time(item.validated_at)} · Latest observation {time(item.latest_observation)}</p>
        {item.coverage?.truncated && <p className="inline-warning">Provider result limit reached. Coverage is incomplete.</p>}
        {item.coverage?.notes?.map((note, index) => <p key={index}>{note}</p>)}
        {item.failure && <p>Provider {item.failure.replaceAll('_', ' ')}{item.http_status ? ` (HTTP ${item.http_status})` : ''}. Retry after {item.retry_after_seconds} s.</p>}
      </div>)}
      {Object.entries(data.optional_sources || {}).map(([key, value]) => <p key={key}>{key.toUpperCase()} · {value}</p>)}
      <p>NOAA IBTrACS and NHC, NASA EONET, USGS, and GDACS.</p>
    </details>
    <p className="weather-source">Educational view of reported events. Consult local authorities for emergency information.</p>
  </div>;
}
