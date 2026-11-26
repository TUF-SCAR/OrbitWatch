import { EVENT_CATEGORIES } from '../data/eventCategories.js';

export const EVENT_STATUS_LABELS = {
  active_confirmed: 'Confirmed active', recent_occurrence: 'Recent occurrence', ended_confirmed: 'Confirmed ended',
  recent_report: 'Recent source report', recently_closed: 'Recently closed by source',
  verification_pending: 'Verification pending', stale_unverified: 'Older or unverified',
};

export function eventStatus(report, now = Date.now()) {
  const evidence = report?.live_status;
  if (!evidence) return { state: 'verification_pending' };
  if (['active_confirmed', 'recent_occurrence', 'recent_report', 'recently_closed'].includes(evidence.state) && !(Date.parse(evidence.expires_at) > now)) {
    return { ...evidence, state: 'stale_unverified', classification: undefined };
  }
  return evidence;
}

export function groupStatus(reports, now) {
  const dated = reports.map(report => ({ report, evidence: eventStatus(report, now) }));
  return dated.find(item => item.evidence.state === 'ended_confirmed')
    || dated.find(item => item.evidence.state === 'active_confirmed' || item.evidence.state === 'recent_occurrence')
    || dated.find(item => item.evidence.state === 'recent_report')
    || dated.find(item => item.evidence.state === 'recently_closed')
    || dated[0];
}

export function isLiveEvent(group) {
  return ['active_confirmed', 'recent_occurrence', 'recent_report', 'recently_closed'].includes(group.status?.state);
}

export function interleaveEventCategories(events) {
  const categories = new Map();
  for (const event of events) {
    if (!categories.has(event.category)) categories.set(event.category, []);
    categories.get(event.category).push(event);
  }
  const ordered = [];
  for (let index = 0; ordered.length < events.length; index++) {
    for (const category of categories.values()) {
      if (index < category.length) ordered.push(category[index]);
    }
  }
  return ordered;
}

export function eventLabel(report, status = eventStatus(report)) {
  if (report.category === 'earthquake') {
    const magnitude = report.measurements?.find(value => /^magnitude\b/i.test(value.label))?.value;
    const location = (report.provider === 'usgs' ? report.description : null) || report.title;
    const place = location.replace(/^M\s*[\d.]+\s*[-–·]\s*/i, '')
      .replace(/^\d+(?:\.\d+)?\s*km\s+[a-z-]+\s+of\s+/i, 'Near ');
    return `${Number.isFinite(magnitude) ? `M${magnitude.toFixed(1)}` : 'Earthquake'} · ${place}`;
  }
  if (report.category === 'cyclone') {
    const name = status.name || report.title.split(' · ')[0].replace(/^(?:Tropical Cyclone|Tropical Storm|Cyclone|Hurricane|Typhoon)\s+/i, '');
    return status.state === 'active_confirmed' && status.classification ? `${name} · ${status.classification}` : name;
  }
  if (report.category === 'flood' && !/\bflood/i.test(report.title)) return `Flooding · ${report.title}`;
  if (report.category === 'volcano' && status.state === 'active_confirmed' && status.classification) return `${report.title} · ${status.classification}`;
  return report.title || EVENT_CATEGORIES[report.category]?.label || 'Reported event';
}
