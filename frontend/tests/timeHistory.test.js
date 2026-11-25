import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveTrackedIds, dayHistory, historyAt, historyChoices, historyDemo, historyIndex, historyLabel, seasonalChoices } from '../src/services/timeHistory.js';

const jan = '2024-01-15T12:00:00Z';
const april = '2024-04-15T12:00:00Z';
const demo = '2024-06-02T16:00:00Z';
const weather = { snapshots: [{ timestamp: april }, { timestamp: jan }] };
const s = { objects: [
  { norad_id: 25544, valid_windows: [{ start: '2024-01-15T10:00:00Z', end: jan }, { start: demo, end: '2024-06-03T00:00:00Z' }] },
  { norad_id: 20580, valid_windows: [{ start: demo, end: '2024-06-02T18:00:00Z' }] },
  { norad_id: 123, valid_windows: [{ start: jan, end: april }] },
] };

test('history only intersects exact stored weather times with inclusive per-satellite validity windows', () => {
  const index = historyIndex(s, weather);
  assert.deepEqual(historyAt(index, new Date(jan)), { weather: weather.snapshots[1], satellites: [25544] });
  assert.deepEqual(historyAt(index, Date.parse(jan) + 1), { weather: null, satellites: [] });
  assert.deepEqual(historyAt(index, new Date(april)), { weather: weather.snapshots[0], satellites: [] });
  assert.equal(historyLabel(null, 0), 'Astronomy only');
  assert.deepEqual(dayHistory(index, 'utc', 2024, 0, 15), { weather: true, satellites: true });
  assert.deepEqual(dayHistory(index, 'utc', 2024, 0, 16), { weather: false, satellites: false });
});

test('verified shortcuts expose the June scene and sorted seasons without inventing dataset overlap', () => {
  const choices = historyChoices(historyIndex(s, weather), { shortcuts: [{ timestamp: '2024-02-29T12:00:00Z' }] });
  assert.deepEqual(historyDemo(choices), { stamp: Date.parse(demo), satellites: [25544, 20580], weather: null });
  assert.equal(historyDemo(historyChoices(historyIndex(null, weather), null)), undefined);
  assert.deepEqual(choices.map(item => item.stamp), [demo, april, jan].map(Date.parse));
  assert.deepEqual(seasonalChoices(weather, new Date(jan)).map(item => item.timestamp), [jan, april]);
  assert.deepEqual(archiveTrackedIds([], [25544, 20580, 40544]), [25544, 20580]);
  assert.deepEqual(archiveTrackedIds([40544, 48274], [25544, 40544]), [40544]);
});
