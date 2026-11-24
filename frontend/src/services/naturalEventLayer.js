import {
  ArcType, BoundingSphere, Cartesian2, Cartesian3, Color, CustomDataSource, HeadingPitchRange,
  Matrix4, PolylineDashMaterialProperty, PolylineGlowMaterialProperty,
} from 'cesium';
import { EVENT_CATEGORIES } from '../data/eventCategories.js';
import { prefersReducedMotion } from '../utils/motionPreferences.js';
import { datedPointSubset, trackPoints, trackSegments, windColor } from './cycloneTracks.js';
import { eventIcon, clusterIcon } from './naturalEventArt.js';
import { groupNaturalEvents, validPoint } from './naturalEventIdentity.js';
import { createNaturalEventOverlay, FORECAST_COLOR, MAX_EVENT_ALTITUDE } from './naturalEventOverlay.js';

const colorFor = category => (EVENT_CATEGORIES[category] || EVENT_CATEGORIES.other).color;
export { EVENT_CATEGORIES, eventIcon, clusterIcon };

function ringsFor(event) {
  if (!event) return [];
  const rings = [];
  let count = 0;
  const geometries = [event.geometry, ...(event.boundaries || [])].slice(0, 16);
  for (const geometry of geometries) {
    const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
    for (const polygon of polygons || []) for (const ring of polygon || []) {
      if (!Array.isArray(ring) || ring.length < 4 || ring.length > 2048 || count + ring.length > 4096
        || !ring.every(validPoint) || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) continue;
      count += ring.length;
      rings.push(ring);
    }
  }
  return rings;
}

export function createNaturalEventLayer(viewer, {
  onSelect = () => {}, onCluster = () => {}, reduced = prefersReducedMotion, makeIcon = eventIcon,
  makeClusterIcon = clusterIcon, now = () => performance.now(), clock = Date.now,
} = {}) {
  const source = new CustomDataSource('OrbitWatch reported natural events');
  const focus = new CustomDataSource('OrbitWatch selected natural event');
  const overlay = createNaturalEventOverlay(viewer, { reduced, now });
  let destroyed = false, enabled = false, selected = null, savedCamera = null, focusFlight = false;
  let eventInput, groupsByReport = new Map(), groups = [], mapGroups = [], mapIds = new Set(), signature = '', selectionKey = '';
  let expiryTimer, focusGeneration = 0;

  // If a two-dimensional canvas is unavailable, retain native Cesium
  // billboards and clustering as a lower-fidelity fallback.
  source.clustering.enabled = !overlay;
  source.clustering.minimumClusterSize = 2;
  source.clustering.pixelRange = 36;
  const removeCluster = source.clustering.clusterEvent.addEventListener((entities, cluster) => {
    cluster.billboard.show = true;
    cluster.billboard.image = makeClusterIcon(entities.length);
    cluster.billboard.width = 38;
    cluster.billboard.height = 38;
    cluster.billboard.id = { orbitwatchEventCluster: entities.map(entity => entity.properties.naturalEventId.getValue()) };
    cluster.label.show = false;
    cluster.point.show = false;
  });
  for (const ds of [source, focus]) viewer.dataSources.add(ds).then(() => {
    if (destroyed && !viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
  });

  function fallbackMarker(ds, group, isSelected = false) {
    if (overlay || !group.position) return;
    const event = group.report, size = isSelected ? 48 : 34;
    ds.entities.add({
      id: `natural:${group.id}`, name: event.title, properties: { naturalEventId: event.id },
      position: Cartesian3.fromDegrees(...group.position, 1200),
      billboard: { image: makeIcon(event.category), width: size, height: size },
      label: isSelected ? { text: event.title.slice(0, 52), font: '600 14px sans-serif',
        fillColor: Color.fromCssColorString(colorFor(event.category)), pixelOffset: new Cartesian2(0, -32),
        showBackground: true, backgroundColor: Color.fromCssColorString('#081323') } : undefined,
    });
  }

  function addBoundaries(ds, event, isSelected) {
    const color = Color.fromCssColorString(colorFor(event.category));
    for (const [i, ring] of ringsFor(event).entries()) ds.entities.add({
      id: `event-boundary:${event.id}:${i}`, properties: { naturalEventId: event.id },
      polyline: {
        positions: ring.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 1200)), arcType: ArcType.GEODESIC,
        width: isSelected ? 4 : 2, material: isSelected
          ? new PolylineGlowMaterialProperty({ color, glowPower: .18, taperPower: 1 }) : color.withAlpha(.72),
      },
    });
  }

  function addTrack(id, group) {
    const paths = [];
    for (const kind of ['observed', 'forecast']) {
      const isForecast = kind === 'forecast';
      const track = (isForecast ? group.forecast : group.path)?.track;
      const points = trackPoints(track, kind, clock());
      const color = Color.fromCssColorString(isForecast ? FORECAST_COLOR : colorFor('cyclone'));
      const segments = trackSegments(points);
      if (overlay) paths.push(...segments.map(segment => ({ kind, points: segment })));
      else for (const [i, segment] of segments.entries()) focus.entities.add({
        id: `track:${kind}:${i}:${id}`, properties: { naturalEventId: id, trackKind: kind },
        polyline: { positions: segment.map(p => Cartesian3.fromDegrees(p.longitude, p.latitude, 6000)),
          arcType: ArcType.GEODESIC, width: isForecast ? 4 : 5,
          material: isForecast ? new PolylineDashMaterialProperty({ color, dashLength: 18 })
            : new PolylineGlowMaterialProperty({ color, glowPower: .16, taperPower: 1 }) },
      });
      const subset = datedPointSubset(points, isForecast ? 16 : 48);
      for (const [i, point] of subset.entries()) {
        const endpoint = i === subset.length - 1;
        focus.entities.add({
          id: `trackpoint:${kind}:${i}:${id}`, name: `${isForecast ? 'Forecast' : 'Reported'} ${point.at}`,
          properties: { naturalEventId: id, trackKind: kind, sourceTimestamp: point.at },
          position: Cartesian3.fromDegrees(point.longitude, point.latitude, 7000),
          point: { pixelSize: endpoint ? 9 : isForecast ? 7 : 5,
            color: Color.fromCssColorString(isForecast ? '#11192c' : windColor(point)),
            outlineColor: isForecast ? color : Color.fromCssColorString('#081323'), outlineWidth: isForecast ? 2 : 1.5 },
          label: endpoint ? {
            text: `${isForecast ? 'Forecast end' : 'Latest path point'} · ${new Date(point.at).toISOString().slice(5, 16).replace('T', ' ')} UTC`,
            font: '600 13px Inter, sans-serif', fillColor: color, backgroundColor: Color.fromCssColorString('#081323ed'),
            showBackground: true, pixelOffset: new Cartesian2(0, isForecast ? -16 : 32),
          } : undefined,
        });
      }
      if (isForecast && points.length) {
        const deadline = Math.min(Date.parse(track.expires_at), Date.parse(points[0].at));
        expiryTimer = setTimeout(() => select(id, true), Math.max(0, deadline - clock()) + 5);
        expiryTimer?.unref?.();
      }
    }
    return paths;
  }

  function select(id, force = false) {
    const group = groupsByReport.get(id);
    const event = group?.reports.find(report => report.id === id);
    const key = JSON.stringify([id, enabled, group?.id, group?.position, event?.geometry, event?.boundaries,
      group?.path?.track, group?.forecast?.track]);
    if (!force && key === selectionKey) return;
    selectionKey = key;
    selected = id;
    clearTimeout(expiryTimer);
    focus.entities.removeAll();
    for (const entity of source.entities.values) {
      entity.show = entity.id !== `natural:${group?.id}` && !entity.id.startsWith(`event-boundary:${id}:`);
    }
    let paths = [];
    if (enabled && group && mapIds.has(group.id)) {
      fallbackMarker(focus, group, true);
      addBoundaries(focus, event, true);
      if (event.category === 'cyclone') paths = addTrack(id, group);
    }
    overlay?.update(mapGroups, group?.id, enabled);
    overlay?.setTracks(id, paths);
    viewer.scene.requestRender();
  }

  return {
    update({ events = [], visible = false, category = 'all', selectedId = null }) {
      if (destroyed || viewer.isDestroyed()) return;
      const visibilityChanged = enabled !== visible;
      enabled = visible;
      source.show = visible;
      focus.show = visible;
      if (eventInput !== events) {
        eventInput = events;
        const result = groupNaturalEvents(events.slice(0, 1200), clock());
        groups = result.groups;
        groupsByReport = result.reportGroups;
      }
      const next = groups.filter(group => category === 'all' || group.report.category === category);
      const key = JSON.stringify(next.map(group => [group.id, group.report.title, group.report.category, group.position,
        group.anchor?.at, !group.position && group.report.geometry, !group.position && group.report.boundaries]));
      if (key !== signature || visibilityChanged) {
        signature = key;
        mapGroups = next;
        mapIds = new Set(next.map(group => group.id));
        source.entities.suspendEvents();
        source.entities.removeAll();
        if (visible) {
          let polygonCount = 0;
          for (const group of next) {
            if (group.position) fallbackMarker(source, group);
            else if (polygonCount++ < 80) addBoundaries(source, group.report, false);
          }
        }
        source.entities.resumeEvents();
        overlay?.update(mapGroups, groupsByReport.get(selectedId)?.id, visible);
        select(selectedId, true);
      } else select(selectedId);
      if (!visible) {
        if (focusFlight) viewer.camera?.cancelFlight?.();
        focusFlight = false;
        savedCamera = null;
        focusGeneration++;
      }
      viewer.scene.requestRender();
    },
    focusEvent(id) {
      const group = groupsByReport.get(id), camera = viewer.camera;
      if (!enabled || !group || !mapIds.has(group.id) || !camera) return false;
      const event = group.reports.find(report => report.id === id);
      const points = [...trackPoints(group.path?.track, 'observed', clock()), ...trackPoints(group.forecast?.track, 'forecast', clock())]
        .map(p => Cartesian3.fromDegrees(p.longitude, p.latitude));
      if (group.position) points.push(Cartesian3.fromDegrees(...group.position));
      for (const ring of ringsFor(event)) for (const [lon, lat] of ring) points.push(Cartesian3.fromDegrees(lon, lat));
      if (!points.length) return false;
      savedCamera ||= { position: Cartesian3.clone(camera.positionWC), direction: Cartesian3.clone(camera.directionWC), up: Cartesian3.clone(camera.upWC) };
      const sphere = BoundingSphere.fromPoints(points);
      sphere.radius = Math.max(90000, sphere.radius);
      const range = Math.max(550000, sphere.radius * 3.6), generation = ++focusGeneration;
      focusFlight = true;
      camera.flyToBoundingSphere(sphere, {
        duration: reduced() ? 0 : 1.4, offset: new HeadingPitchRange(0, -Math.PI / 2, range),
        complete: () => { if (generation === focusGeneration) focusFlight = false; if (!destroyed) viewer.scene.requestRender(); },
        cancel: () => { if (generation === focusGeneration) focusFlight = false; },
      });
      return true;
    },
    returnFromFocus() {
      if (!savedCamera || !viewer.camera) return false;
      const saved = savedCamera;
      savedCamera = null;
      focusGeneration++;
      focusFlight = false;
      viewer.camera.cancelFlight?.();
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      viewer.camera.setView({ destination: saved.position, orientation: { direction: saved.direction, up: saved.up } });
      viewer.scene.requestRender();
      return true;
    },
    pick(picked, point) {
      if (!enabled || viewer.camera?.positionCartographic?.height > MAX_EVENT_ALTITUDE) return false;
      const item = point && overlay?.pick(point);
      const id = item ? null : (typeof picked === 'function' ? picked() : picked)?.id;
      const ids = item || id?.orbitwatchEventCluster;
      if (ids?.length > 1) { onCluster(ids); return true; }
      const reportId = ids?.[0] || id?.properties?.naturalEventId?.getValue?.();
      if (!reportId) return false;
      onSelect(reportId);
      return true;
    },
    diagnostics() {
      return { visible: enabled, context: mapGroups.length, selected: focus.entities.values.length,
        selectedId: selected, clustered: true, ...overlay?.diagnostics() };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(expiryTimer);
      overlay?.destroy();
      removeCluster();
      if (focusFlight) viewer.camera?.cancelFlight?.();
      for (const ds of [source, focus]) if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
      eventInput = null;
      groups = [];
      mapGroups = [];
      mapIds.clear();
      groupsByReport.clear();
      savedCamera = null;
    },
  };
}
