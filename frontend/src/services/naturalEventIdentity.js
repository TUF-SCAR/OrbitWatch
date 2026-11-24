import { trackPoints } from './cycloneTracks.js';

const providerOrder = { ibtracs: 0, eonet: 1, gdacs: 2, nhc: 3 };
const atcf = /^(?:AL|EP|CP|WP|IO|SH)\d{6}$/;
const instant = value => Date.parse(value) || 0;
const reportTime = e => instant(e.last_report_at || e.reported_at);
export const validPoint = p => Array.isArray(p) && Number.isFinite(p[0]) && Math.abs(p[0]) <= 180
  && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90;

function url(value) {
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password ? parsed : null;
  } catch { return null; }
}

function reportKey(input) {
  if (!input) return null;
  if (input.hostname === 'eonet.gsfc.nasa.gov') {
    const id = input.pathname.match(/^\/api\/v3\/events\/([\w-]+)\/?$/)?.[1];
    return id && `eonet:${id}`;
  }
  if (['www.gdacs.org', 'gdacs.org'].includes(input.hostname) && input.pathname.toLowerCase() === '/report.aspx') {
    const id = input.searchParams.get('eventid');
    if (input.searchParams.get('eventtype') === 'TC' && /^\d+$/.test(id)) return `gdacs:TC:${id}`;
  }
  return null;
}

function cycloneKeys(event) {
  const keys = [];
  if (event.provider === 'ibtracs') {
    for (const id of event.track?.atcf_ids || []) if (atcf.test(id)) keys.push(`atcf:${id}`);
  }
  if (event.provider === 'nhc' && atcf.test(event.track?.official_id) && event.track.official_id === event.provider_event_id) {
    keys.push(`atcf:${event.provider_event_id}`);
  }
  const officialReport = reportKey(url(event.source_url));
  if (officialReport === event.id) keys.push(`report:${officialReport}`);
  const year = new Date(reportTime(event)).getUTCFullYear();
  const jtwcKeys = new Set();
  for (const reference of event.references || []) {
    const link = url(reference.url);
    const key = reportKey(link);
    if (key) keys.push(`report:${key}`);
    // A JTWC product filename contains the official basin, storm number,
    // and two-digit season. This only bridges to an exact full ATCF ID.
    if (event.provider !== 'eonet' || String(reference.provider).toUpperCase() !== 'JTWC'
      || link?.hostname !== 'www.metoc.navy.mil' || year < 2000 || year > 2099) continue;
    const code = link.pathname.match(/^\/jtwc\/products\/((?:wp|io|sh)\d{2})(\d{2})\.tcw$/i);
    if (code) jtwcKeys.add(`atcf:${code[1].toUpperCase()}20${code[2]}`);
  }
  if (jtwcKeys.size === 1) keys.push(...jtwcKeys);
  return [...new Set(keys)];
}

function compareReports(a, b) {
  return (providerOrder[a.provider] ?? 9) - (providerOrder[b.provider] ?? 9) || a.id.localeCompare(b.id);
}

function displayGroup(reports, now) {
  const sorted = [...reports].sort(compareReports);
  const cyclone = sorted[0].category === 'cyclone';
  const path = cyclone ? sorted.find(e => trackPoints(e.track, 'observed', now).length > 1) : undefined;
  const forecast = (cyclone ? sorted : []).filter(e => trackPoints(e.track, 'forecast', now).length)
    .sort((a, b) => instant(b.track.issued_at) - instant(a.track.issued_at))[0];
  const anchors = sorted.flatMap(report => {
    const observed = cyclone ? trackPoints(report.track, 'observed', now).at(-1) : null;
    // For a linked storm, never prefer a GDACS centroid to a dated position.
    const at = reportTime(report);
    const isArea = ['Polygon', 'MultiPolygon'].includes(report.geometry?.type);
    const own = !isArea && validPoint(report.position) && at && at <= now ? { report, position: report.position, at } : null;
    const point = observed ? { report, position: [observed.longitude, observed.latitude], at: instant(observed.at) } : null;
    return [own, point].filter(Boolean);
  });
  anchors.sort((a, b) => Number(a.report.provider === 'gdacs') - Number(b.report.provider === 'gdacs')
    || b.at - a.at || compareReports(a.report, b.report));
  const anchor = anchors[0];
  const identity = sorted[0].id;
  return {
    id: identity, reports: sorted, report: sorted[0], anchor, path, forecast,
    position: anchor?.position ?? null,
  };
}

export function groupNaturalEvents(events, now = Date.now()) {
  // Same ID means a newer revision of the same report, never a second pin.
  const byId = new Map();
  for (const report of events) {
    if (!report?.id) continue;
    const previous = byId.get(report.id);
    const revision = e => instant(e.source_updated_at || e.updated_at) || reportTime(e);
    if (!previous || revision(report) > revision(previous)) byId.set(report.id, report);
  }
  const cyclones = [...byId.values()].filter(e => e.category === 'cyclone');
  const keys = new Map(), links = new Map(cyclones.map(e => [e.id, new Set()]));
  for (const event of cyclones) for (const key of cycloneKeys(event)) {
    if (!keys.has(key)) keys.set(key, []);
    keys.get(key).push(event);
  }
  for (const [key, reports] of keys) {
    if (reports.length < 2 || new Set(reports.map(e => e.provider)).size !== reports.length) continue;
    // A shared reference alone is insufficient. Require an event-specific
    // official report or an owner of the full storm identifier.
    if (key.startsWith('report:') ? !reports.some(e => `report:${e.id}` === key)
      : !reports.some(e => ['ibtracs', 'nhc'].includes(e.provider))) continue;
    for (const { id } of reports) for (const other of reports) if (id !== other.id) links.get(id).add(other.id);
  }
  const seen = new Set(), groups = [];
  for (const event of byId.values()) {
    if (seen.has(event.id)) continue;
    const component = [event];
    seen.add(event.id);
    for (const report of component) for (const peer of links.get(report.id) || []) {
      if (seen.has(peer)) continue;
      seen.add(peer);
      component.push(byId.get(peer));
    }
    // Conflicting links are ambiguous, including when a third report bridges
    // two different IDs from a single provider. Keep all reports separate.
    if (new Set(component.map(e => e.provider)).size !== component.length) {
      groups.push(...component.map(report => displayGroup([report], now)));
    } else groups.push(displayGroup(component, now));
  }
  const reportGroups = new Map(groups.flatMap(group => group.reports.map(report => [report.id, group])));
  return { groups, reportGroups };
}
