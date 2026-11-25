import { TIME_DEFAULT_OBJECTS, TIME_SATELLITE_IDS } from '../data/timeExplorerCatalog.js';
import { validSceneTime } from '../utils/sceneCalendar.js';

const SEASON_MONTHS = [0, 3, 6, 9];
const DEMO_TIME = Date.parse('2024-06-02T16:00:00Z');
const catalogIds = new Set(TIME_SATELLITE_IDS);

export function historyIndex(satelliteCoverage, weatherCoverage) {
  const windows = (satelliteCoverage?.objects || []).flatMap(object => {
    if (!catalogIds.has(object.norad_id)) return [];
    return (object.valid_windows || []).map(window => ({ id: object.norad_id, start: Date.parse(window.start), end: Date.parse(window.end) }));
  }).filter(window => Number.isFinite(window.start) && window.end >= window.start);
  const weather = new Map();
  for (const snapshot of weatherCoverage?.snapshots || []) {
    const date = new Date(snapshot.timestamp);
    if (validSceneTime(date)) weather.set(date.getTime(), snapshot);
  }
  return { windows, weather };
}

export function historyAt(index, time) {
  const stamp = Number(time);
  const ids = new Set(index.windows.filter(w => w.start <= stamp && w.end >= stamp).map(w => w.id));
  return { weather: index.weather.get(stamp) || null, satellites: TIME_SATELLITE_IDS.filter(id => ids.has(id)) };
}

export function historyLabel(weather, satellites) {
  if (weather && satellites) return 'Weather + satellites';
  if (weather) return 'Weather available';
  if (satellites) return 'Satellites available';
  return 'Astronomy only';
}

export function dayHistory(index, zone, year, month, day) {
  const boundary = date => zone === 'utc' ? Date.UTC(year, month, date) : new Date(year, month, date).getTime();
  const start = boundary(day), end = boundary(day + 1);
  return {
    weather: [...index.weather.keys()].some(stamp => stamp >= start && stamp < end),
    satellites: index.windows.some(window => window.start < end && window.end >= start),
  };
}

export function historyChoices(index, coverage) {
  const candidates = new Set(index.weather.keys());
  for (const item of coverage?.shortcuts || []) candidates.add(Date.parse(item.timestamp));
  const years = new Set(index.windows.map(window => new Date(window.start).getUTCFullYear()));
  for (const year of years) for (const month of SEASON_MONTHS) candidates.add(Date.UTC(year, month, 15, 12));
  candidates.add(DEMO_TIME);
  return [...candidates].filter(stamp => validSceneTime(new Date(stamp)))
    .map(stamp => ({ stamp, ...historyAt(index, stamp) }))
    .filter(item => item.weather || item.satellites.length)
    .sort((a, b) => b.stamp - a.stamp);
}

export function historyDemo(choices) {
  return choices.find(item => item.stamp === DEMO_TIME && item.satellites.length);
}

export function seasonalChoices(coverage, time) {
  const year = time.getUTCFullYear();
  return (coverage?.snapshots || []).filter(item => {
    const date = new Date(item.timestamp);
    return validSceneTime(date) && date.getUTCFullYear() === year && SEASON_MONTHS.includes(date.getUTCMonth())
      && date.getUTCDate() === 15 && date.getUTCHours() === 12 && date.getUTCMinutes() === 0
      && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function archiveTrackedIds(existing, available) {
  const supported = new Set(available);
  const retained = existing.filter(id => supported.has(id));
  if (retained.length) return retained;
  const defaults = TIME_DEFAULT_OBJECTS.filter(id => supported.has(id));
  return defaults.length ? defaults : available.slice(0, TIME_DEFAULT_OBJECTS.length);
}
