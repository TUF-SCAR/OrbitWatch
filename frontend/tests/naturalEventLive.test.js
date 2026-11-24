import assert from 'node:assert/strict';
import test from 'node:test';
import { Cartesian3, Cartesian4, Ellipsoid, Matrix4, PerspectiveFrustum } from 'cesium';
import { globeSilhouette, pointInsideSilhouette } from '../src/services/naturalEventHorizon.js';
import { groupNaturalEvents } from '../src/services/naturalEventIdentity.js';
import { eventLabel, isLiveEvent } from '../src/services/naturalEventPresentation.js';
import { forecastCone, trackPoints } from '../src/services/cycloneTracks.js';

const ellipsoid = Ellipsoid.WGS84;
const now = Date.parse('2026-11-24T08:00:00Z');
const at = hours => new Date(now + hours * 3600000).toISOString();

function cameraAt(distance, azimuth, width, height, tilt = 0) {
  const pos = Cartesian3.fromRadians(azimuth, 0, distance - ellipsoid.maximumRadius);
  const direction = new Cartesian3(-Math.cos(azimuth + tilt), -Math.sin(azimuth + tilt), 0);
  const up = Cartesian3.UNIT_Z;
  const right = Cartesian3.cross(direction, up, new Cartesian3());
  const frustum = new PerspectiveFrustum({ fov: Math.PI / 3, aspectRatio: width / height, near: 1, far: 1e9 });
  return { positionWC: pos, frustum, viewMatrix: Matrix4.computeView(pos, direction, up, right, new Matrix4()) };
}

function project(camera, point, width, height) {
  const world = new Cartesian4(point.x, point.y, point.z, 1);
  const view = Matrix4.multiplyByVector(camera.viewMatrix, world, new Cartesian4());
  const p = Matrix4.multiplyByVector(camera.frustum.projectionMatrix, view, new Cartesian4());
  return { x: (1 + p.x / p.w) * width / 2, y: (1 - p.y / p.w) * height / 2 };
}

test('camera-derived ellipsoid masks split a limb icon and keep the far hemisphere hidden until rotation', () => {
  for (const [width, height] of [[360, 800], [390, 844], [844, 390], [1280, 900], [1920, 1080]]) {
    const camera = cameraAt(5 * ellipsoid.maximumRadius, 0, width, height, .05);
    const { polygon, depth } = globeSilhouette(camera, ellipsoid, width, height);
    const limb = Cartesian3.fromRadians(Math.acos(1 / 5), 0);
    const p = project(camera, limb, width, height);
    assert.ok(Math.abs(depth(limb)) < 1e-12);
    assert.equal(pointInsideSilhouette(polygon, p.x - 9, p.y), true);
    assert.equal(pointInsideSilhouette(polygon, p.x + 9, p.y), false);
    const hidden = Cartesian3.fromDegrees(110, 0);
    assert.ok(depth(hidden) < -.4);
    const rotated = globeSilhouette(cameraAt(5 * ellipsoid.maximumRadius, Math.PI / 2, width, height), ellipsoid, width, height);
    assert.ok(rotated.depth(hidden) > .7);
    const close = globeSilhouette(cameraAt(ellipsoid.maximumRadius + 2e4, 0, width, height), ellipsoid, width, height);
    for (const [x, y] of [[6, 6], [width - 6, 6], [6, height - 6], [width - 6, height - 6]]) {
      assert.equal(pointInsideSilhouette(close.polygon, x, y), true);
    }
  }
});

test('live projection uses the evidence center, excludes ended groups and expires separate quakes at origin +24h', () => {
  const storm = { id: 'ibtracs:1', provider: 'ibtracs', category: 'cyclone', title: 'Storm · WP 2026',
    reported_at: at(-4), position: [-85, 17], track: { official_id: '1', atcf_ids: ['AL012026'] },
    live_status: { state: 'active_confirmed', name: 'Rina', at: at(-1), expires_at: at(11),
      classification: 'Tropical Storm', position: [-83, 19] } };
  const ended = { ...storm, id: 'ibtracs:2026321N11087', track: null,
    live_status: { state: 'ended_confirmed', classification: 'Low Pressure Area', at: at(-72) } };
  const quake = { id: 'usgs:a', provider: 'usgs', category: 'earthquake', title: 'M 5.3 - 18 km NNW of Mangan, India',
    description: '18 km NNW of Mangan, India', measurements: [{ label: 'Magnitude (mww)', value: 5.3 }],
    position: [88.5, 27.5], reported_at: at(-22), live_status: { state: 'recent_occurrence', expires_at: at(2) } };
  const quakes = [quake, { ...quake, id: 'usgs:b' }];
  const events = [storm, ended, ...quakes];
  const groups = groupNaturalEvents(events, now).groups.filter(isLiveEvent);
  assert.deepEqual(groups.map(group => group.id), [storm.id, ...quakes.map(item => item.id)]);
  assert.deepEqual(groups[0].position, [-83, 19]);
  assert.equal(groups[0].label, 'Rina · Tropical Storm');
  assert.equal(eventLabel(quake), 'M5.3 · Near Mangan, India');
  assert.equal(groupNaturalEvents(events, now + 3 * 3600000).groups.filter(isLiveEvent).length, 1);
});

test('cone requires matching official advisory, valid geometry and a remaining forecast', () => {
  const shape = { type: 'Polygon', coordinates: [[[179, 4], [-178, 3], [-178, 7], [179, 4]]] };
  const track = { official_id: '123', forecast_official_id: 'CP012026', issued_at: at(-2), expires_at: at(5),
    forecast: [0, 4].map(hours => ({ at: at(hours), issued_at: at(-2), longitude: 179, latitude: 5, classification: 'forecast' })),
    cone: { official_id: 'CP012026', issued_at: at(-2), expires_at: at(5), geometry: shape,
      source_url: 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer/268' } };
  assert.equal(trackPoints(track, 'forecast', now).length, 1);
  assert.deepEqual(forecastCone(track, now)?.polygons, [shape.coordinates]);
  assert.equal(forecastCone({ ...track, cone: undefined }, now), null);
  assert.equal(forecastCone({ ...track, cone: { ...track.cone, issued_at: at(-1) } }, now), null);
  assert.equal(forecastCone({ ...track, cone: { ...track.cone, geometry: { type: 'Polygon', coordinates: [[[0, 1]]] } } }, now), null);
  assert.equal(forecastCone(track, now + 6 * 3600000), null);
});
