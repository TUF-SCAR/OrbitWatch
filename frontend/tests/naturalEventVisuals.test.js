import assert from 'node:assert/strict';
import test from 'node:test';
import { Cartesian3, Cartographic, Ellipsoid, Event, SceneMode, SceneTransforms } from 'cesium';
import { EVENT_CATEGORIES } from '../src/data/eventCategories.js';
import { clusterIcon, eventIcon } from '../src/services/naturalEventArt.js';
import { groupNaturalEvents } from '../src/services/naturalEventIdentity.js';
import { createNaturalEventLayer } from '../src/services/naturalEventLayer.js';
import { clusterProjectedEvents, eventOverlayPixelRatio, FORECAST_COLOR } from '../src/services/naturalEventOverlay.js';

const clock = Date.parse('2026-11-08T00:00:00Z');
const at = offset => new Date(clock + offset).toISOString();
const report = (id, category, extra = {}) => ({
  id, category, provider: id.split(':')[0], title: 'Same title for identity controls', position: [80, 20],
  reported_at: at(-3600000), ...extra,
});
const archive = report('ibtracs:2026297N11166', 'cyclone', {
  track: { official_id: '2026297N11166', atcf_ids: ['WP302026'], observed: [
    { longitude: 78, latitude: 20, at: at(-10800000) }, { longitude: 80, latitude: 20, at: at(-3600000) },
  ] },
});
const linked = report('eonet:EONET_25728', 'cyclone', {
  position: [81, 20], reported_at: at(-1800000),
  references: [{ provider: 'JTWC', url: 'https://www.metoc.navy.mil/jtwc/products/wp3026.tcw' }],
});

function layerFixture(options = {}) {
  const sources = [], render = new Event(), canvas = options.canvas, picked = [], clusters = [];
  const viewer = {
    scene: { canvas, postRender: render, requestRender() {}, globe: { ellipsoid: Ellipsoid.WGS84 }, mode: SceneMode.SCENE2D },
    isDestroyed: () => false,
    camera: {
      positionWC: new Cartesian3(0, 0, 3e7), directionWC: new Cartesian3(0, 0, -1), upWC: new Cartesian3(0, 1, 0),
      positionCartographic: { height: 3e5 }, frustum: { fov: 1 }, cancelFlight() {},
    },
    dataSources: {
      add(source) { sources.push(source); return Promise.resolve(source); },
      remove(source) { const index = sources.indexOf(source); if (index >= 0) sources.splice(index, 1); },
    },
  };
  const owner = createNaturalEventLayer(viewer, {
    clock: options.clock || (() => clock), reduced: options.reduced || (() => true),
    makeIcon: () => 'fixture-mark', onSelect: id => picked.push(id), onCluster: ids => clusters.push(ids),
  });
  return { owner, viewer, render, sources, picked, clusters };
}

test('explicit JTWC/ATCF identity combines reports and preserves the newest dated position and original path', () => {
  const unrelated = report('gdacs:TC:7', 'cyclone', { position: [81, 20] });
  const revised = { ...linked, position: [82, 21], reported_at: at(-800000) };
  const result = groupNaturalEvents([revised, unrelated, linked, archive], clock);
  assert.equal(result.groups.length, 2);
  const storm = result.reportGroups.get(archive.id);
  assert.equal(storm, result.reportGroups.get(linked.id));
  assert.deepEqual(storm.position, revised.position);
  assert.equal(storm.anchor.report.id, linked.id);
  assert.equal(storm.path, archive);
  assert.equal(storm.id, groupNaturalEvents([archive, unrelated, linked, revised], clock).reportGroups.get(linked.id).id);
  assert.notEqual(storm, result.reportGroups.get(unrelated.id));
  assert.equal(archive.position[0], 80);
});

test('official report links are scoped to a unique ID, and lookalike and ambiguous storms stay separate', () => {
  const gdacs = report('gdacs:TC:93', 'cyclone', { source_url: 'https://www.gdacs.org/report.aspx?eventid=93&episodeid=3&eventtype=TC' });
  const nasa = { ...linked, references: [{ url: 'https://www.gdacs.org/report.aspx?eventtype=TC&eventid=93&episodeid=2' }] };
  assert.equal(groupNaturalEvents([gdacs, nasa], clock).groups.length, 1);
  const spoof = { ...linked, references: [{ provider: 'JTWC', url: 'https://www.metoc.navy.mil.example.test/jtwc/products/wp3026.tcw' }] };
  assert.equal(groupNaturalEvents([archive, spoof], clock).groups.length, 2);
  assert.equal(groupNaturalEvents([archive, { ...archive, id: 'ibtracs:second' }, linked], clock).groups.length, 3);
  const ambiguous = { ...linked, references: [...linked.references, { provider: 'JTWC', url: 'https://www.metoc.navy.mil/jtwc/products/wp3126.tcw' }] };
  assert.equal(groupNaturalEvents([archive, ambiguous], clock).groups.length, 2);
  const generic = report('ibtracs:generic', 'cyclone', { source_url: 'https://www.ncei.noaa.gov/products/international-best-track-archive' });
  assert.equal(groupNaturalEvents([generic, { ...linked, references: [{ url: generic.source_url }], related_ids: [generic.id] }], clock).groups.length, 2);
});

test('map ownership shows one cyclone marker, preserves earthquakes and switches the selected alias', () => {
  const fixture = layerFixture();
  const quakes = [report('usgs:1', 'earthquake'), report('usgs:2', 'earthquake')];
  const events = [linked, archive, ...quakes];
  fixture.owner.update({ events, visible: true });
  assert.equal(fixture.sources[0].entities.values.filter(e => e.billboard).length, 3);
  fixture.owner.update({ events, visible: true, selectedId: linked.id });
  assert.deepEqual(fixture.sources[0].entities.values.filter(e => !e.show).map(e => e.id), [`natural:${archive.id}`]);
  assert.equal(fixture.sources[1].entities.values.filter(e => e.billboard).length, 1);
  fixture.owner.update({ events, visible: true, category: 'earthquake' });
  assert.equal(fixture.sources[0].entities.values.length, 2);
  assert.equal(fixture.sources[1].entities.values.length, 0);
  fixture.owner.update({ events, visible: false });
  assert.equal(fixture.owner.pick({ id: { orbitwatchEventCluster: quakes.map(e => e.id) } }), false);
  fixture.owner.destroy();
  assert.equal(fixture.sources.length, 0);
});

test('sprite assets are deterministic and each category has distinct cacheable vector art', () => {
  const categories = Object.keys(EVENT_CATEGORIES);
  const icons = categories.map(eventIcon);
  assert.equal(new Set(icons).size, categories.length);
  assert.ok(icons.every(icon => decodeURIComponent(icon).includes('width="192"')));
  assert.deepEqual(categories.map(eventIcon), icons);
  assert.equal(eventIcon('unknown'), eventIcon('other'));
  assert.equal(clusterIcon(100), clusterIcon(1200));
  assert.notEqual(clusterIcon(5), clusterIcon(6));
  assert.equal(eventOverlayPixelRatio(390, 844, 3), 3);
  assert.ok(eventOverlayPixelRatio(1920, 1080, 2) < 2);
});

test('clustering uses projected proximity, leaves a selected member out and bounds dense draw counts', () => {
  const points = [0, 12, 98].map((x, i) => ({ id: String(i), report: { id: String(i) }, x, y: 50 }));
  assert.deepEqual(clusterProjectedEvents(points, 20).map(marker => marker.ids), [['0', '1'], ['2']]);
  assert.deepEqual(clusterProjectedEvents(points, 20, '0').map(marker => marker.ids), [['1'], ['2'], ['0']]);
  assert.equal(clusterProjectedEvents(points, 8).length, 3);
  const dense = Array.from({ length: 250 }, (_, i) => ({ id: String(i), report: { id: String(i) }, x: 25 * i, y: 0 }));
  assert.equal(clusterProjectedEvents(dense, 20, '249').length, 161);
  const quake = { ...points[0], report: { id: '0', category: 'earthquake' } };
  const flood = { ...points[1], report: { id: '1', category: 'flood' } };
  const [cluster] = clusterProjectedEvents([quake, flood], 20);
  assert.equal(cluster.report.category, 'flood');
  assert.deepEqual(cluster.ids, ['1', '0']);
});

test('overlay paint and hit tests use CSS/device pixels, honor reduced motion and clean up on mode changes', context => {
  let paints = 0, requests = 0, removed = false, reduce = true;
  const strokes = [];
  let dash = [], coneFills = 0;
  const c = new Proxy({
    clearRect() { paints++; }, measureText: text => ({ width: text.length * 7 }),
    setLineDash(value) { dash = value; },
    stroke() { if (this.lineWidth === 2.6) strokes.push([this.strokeStyle, dash]); },
    fill(rule) { if (rule === 'evenodd') coneFills++; },
  }, { get: (target, key) => target[key] || (() => {}) });
  const overlay = { width: 0, height: 0, setAttribute() {}, getContext: () => c, remove() { removed = true; } };
  const previous = [globalThis.document, globalThis.window, globalThis.Image];
  globalThis.document = { createElement: () => overlay };
  globalThis.window = { devicePixelRatio: 3 };
  globalThis.Image = class { complete = true; naturalWidth = 192; };
  context.after(() => { [globalThis.document, globalThis.window, globalThis.Image] = previous; });
  context.mock.method(SceneTransforms, 'worldToWindowCoordinates', () => ({ x: 172, y: 180 }));
  const canvas = { clientWidth: 390, clientHeight: 844, parentElement: { append() {} } };
  const fixture = layerFixture({ canvas, reduced: () => reduce });
  fixture.viewer.scene.requestRender = () => { requests++; };
  const events = [report('usgs:1', 'earthquake'), report('usgs:2', 'earthquake')];
  fixture.owner.update({ events, visible: true });
  fixture.render.raiseEvent();
  assert.equal(overlay.width, 1170);
  assert.equal(fixture.owner.diagnostics().clusters, 1);
  assert.equal(fixture.owner.pick(() => assert.fail('overlay hit should bypass Cesium pick'), { x: 172, y: 180 }), true);
  assert.deepEqual(fixture.clusters[0], ['usgs:1', 'usgs:2']);
  fixture.owner.update({ events, visible: true, selectedId: 'usgs:1' });
  fixture.render.raiseEvent();
  const frames = paints, requested = requests;
  fixture.render.raiseEvent();
  assert.equal(paints, frames);
  assert.equal(requests, requested, 'reduced motion never keeps the renderer active');
  assert.equal(fixture.owner.pick(null, { x: 172, y: 180 }), true);
  assert.equal(fixture.picked.at(-1), 'usgs:1');
  reduce = false;
  fixture.render.raiseEvent();
  assert.ok(requests > requested, 'selection has a single on-demand frame owner');
  fixture.viewer.camera.positionCartographic.height = 2e8;
  fixture.render.raiseEvent();
  assert.equal(overlay.hidden, true, 'solar overview does not carry surface markers');
  assert.equal(fixture.owner.pick(null, { x: 172, y: 180 }), false);
  fixture.viewer.camera.positionCartographic.height = 3e5;
  fixture.render.raiseEvent();
  assert.equal(overlay.hidden, false);

  SceneTransforms.worldToWindowCoordinates.mock.mockImplementation((_, world) => {
    const position = Cartographic.fromCartesian(world);
    return { x: 100 + (position.longitude * 180 / Math.PI - 70) * 10, y: 180 };
  });
  const cyclone = { ...archive, track: { ...archive.track, issued_at: at(-1000), expires_at: at(3600000),
    cone: { official_id: archive.track.official_id, issued_at: at(-1000), expires_at: at(3600000),
      source_url: 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer/268',
      geometry: { type: 'Polygon', coordinates: [[[87, 18], [92, 19], [93, 21], [87, 18]]] } },
    forecast: [88, 92].map((longitude, index) => ({ longitude, latitude: 20, at: at((index + 1) * 3600000),
      issued_at: at(-1000), classification: 'forecast' })) } };
  fixture.owner.update({ events: [cyclone], visible: true, selectedId: cyclone.id });
  fixture.render.raiseEvent();
  assert.deepEqual(strokes, [[EVENT_CATEGORIES.cyclone.color, []], [FORECAST_COLOR, [7, 6]]]);
  assert.equal(coneFills, 1);
  assert.equal(fixture.owner.pick(null, { x: 300, y: 180 }), true, 'an on-screen path routes to its source report');
  assert.equal(fixture.picked.at(-1), cyclone.id);
  assert.equal(fixture.owner.pick(null, { x: 250, y: 180 }), false, 'the gap between observed and forecast is preserved');
  fixture.owner.update({ events: [cyclone], visible: true, selectedId: cyclone.id, cone: false });
  fixture.render.raiseEvent();
  assert.equal(coneFills, 1);
  fixture.owner.update({ events: [cyclone], visible: true });
  assert.equal(fixture.owner.pick(null, { x: 300, y: 180 }), false);
  fixture.owner.update({ events, visible: false });
  assert.equal(fixture.render.numberOfListeners, 0);
  fixture.owner.destroy();
  assert.equal(removed, true);
  assert.equal(fixture.sources.length, 0);
});

test('forecast-only records expire without producing an observed marker', async () => {
  let simulated = clock;
  const fixture = layerFixture({ clock: () => simulated });
  const event = report('nhc:AL012026', 'cyclone', {
    position: null, provider_event_id: 'AL012026',
    track: { official_id: 'AL012026', issued_at: at(-1000), expires_at: at(12), observed: [],
      forecast: [1, 2].map(n => ({ longitude: 79 + n, latitude: 20, at: at(n * 60000),
        issued_at: at(-1000), classification: 'forecast' })) },
  });
  fixture.owner.update({ events: [event], visible: true, selectedId: event.id });
  assert.equal(fixture.sources[0].entities.values.length, 0);
  assert.ok(fixture.sources[1].entities.values.some(e => e.polyline?.material.getType() === 'PolylineDash'));
  simulated += 50;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(fixture.sources[1].entities.values.length, 0);
  fixture.owner.destroy();
});
