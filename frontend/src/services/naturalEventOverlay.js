import { Cartesian2, Cartesian3, Cartographic, EllipsoidGeodesic, EllipsoidalOccluder, SceneMode, SceneTransforms } from 'cesium';
import { EVENT_CATEGORIES } from '../data/eventCategories.js';
import { clusterIcon, eventIcon } from './naturalEventArt.js';

const MAX_MARKERS = 160;
export const MAX_EVENT_ALTITUDE = 1.2e8;
const priority = { cyclone: 0, volcano: 1, earthquake: 2, flood: 3 };
const styleFor = category => EVENT_CATEGORIES[category] || EVENT_CATEGORIES.other;
export const FORECAST_COLOR = '#ffd28e';

export function clusterProjectedEvents(points, radius, selectedId) {
  const buckets = new Map(), markers = [];
  const key = (x, y) => `${x}:${y}`;
  for (const point of points) {
    if (point.id === selectedId) continue;
    const col = Math.floor(point.x / radius), row = Math.floor(point.y / radius);
    let match, nearest = radius ** 2;
    for (let y = row - 1; y <= row + 1; y++) for (let x = col - 1; x <= col + 1; x++) {
      for (const marker of buckets.get(key(x, y)) || []) {
        const distance = (marker.x - point.x) ** 2 + (marker.y - point.y) ** 2;
        if (distance < nearest) { nearest = distance; match = marker; }
      }
    }
    if (match) { match.ids.push(point.report.id); continue; }
    const marker = { ...point, ids: [point.report.id] };
    const bucket = key(col, row);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(marker);
    markers.push(marker);
  }
  const selected = points.find(point => point.id === selectedId);
  return [...markers.slice(0, MAX_MARKERS), ...(selected ? [{ ...selected, ids: [selected.report.id], selected: true }] : [])];
}

const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function labelBox(marker, width, height, textWidth) {
  const left = Math.max(6, Math.min(width - textWidth - 6, marker.x - textWidth / 2));
  const top = marker.y - marker.size / 2 - 28;
  const positions = [top, marker.y + marker.size / 2 + 5];
  return positions.filter(y => y >= 7 && y + 23 <= height - 7)
    .map(y => ({ left, top: y, right: left + textWidth, bottom: y + 23 }));
}

function drawLabel(ctx, box, label, color, selected) {
  ctx.beginPath();
  ctx.roundRect(box.left, box.top, box.right - box.left, 23, 6);
  ctx.fillStyle = selected ? '#101e33' : '#081323ed';
  ctx.fill();
  ctx.lineWidth = selected ? 1.4 : 1;
  ctx.strokeStyle = selected ? color : '#91a7bf64';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(label, box.left + 8, box.top + 12);
}

export function eventOverlayPixelRatio(width, height, deviceRatio) {
  return Math.min(deviceRatio || 1, 3, Math.sqrt(5_500_000 / Math.max(1, width * height)));
}

function trackVertices(points, ellipsoid) {
  const vertices = [], geodesic = new EllipsoidGeodesic(undefined, undefined, ellipsoid);
  const coordinates = points.map(point => Cartographic.fromDegrees(point.longitude, point.latitude));
  for (const [index, coordinate] of coordinates.entries()) {
    if (index > 0) {
      const previous = coordinates[index - 1];
      if (!Cartographic.equals(previous, coordinate)) {
        geodesic.setEndPoints(previous, coordinate);
        // Tessellate the connecting line, leaving the source positions and dates intact.
        const steps = Math.ceil(geodesic.surfaceDistance / 80000);
        for (let step = 1; step < steps; step++) {
          vertices.push(ellipsoid.cartographicToCartesian(geodesic.interpolateUsingFraction(step / steps)));
        }
      }
    }
    vertices.push(ellipsoid.cartographicToCartesian(coordinate));
  }
  return vertices;
}

function drawTracks(ctx, tracks) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const { kind, parts } of tracks) {
    const forecast = kind === 'forecast';
    ctx.beginPath();
    for (const part of parts) {
      ctx.moveTo(part[0].x, part[0].y);
      for (let i = 1; i < part.length; i++) ctx.lineTo(part[i].x, part[i].y);
    }
    ctx.setLineDash(forecast ? [7, 6] : []);
    ctx.lineWidth = 6;
    ctx.strokeStyle = forecast ? '#291b10b3' : '#2f2155c9';
    ctx.stroke();
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = forecast ? FORECAST_COLOR : styleFor('cyclone').color;
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function isNearSegment(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const along = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - (a.x + dx * along), point.y - (a.y + dy * along)) <= 6;
}

export function createNaturalEventOverlay(viewer, { reduced, now }) {
  const scene = viewer.scene;
  const parent = scene.canvas?.parentElement;
  if (!parent || !scene.postRender) return null;
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (!context) return null;
  canvas.className = 'natural-event-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  parent.append(canvas);
  const horizon = new EllipsoidalOccluder(scene.globe.ellipsoid);
  const projected = new Cartesian2(), images = new Map(), sizes = new Map();
  let entries = [], markers = [], hits = [], selected = null, visible = false, offRender, groupInput;
  let worldTracks = [], screenTracks = [], trackReportId;
  let dirty = true, lastFrame = '', lastPaint = 0, destroyed = false;

  function asset(uri) {
    if (!images.has(uri)) {
      if (images.size >= 72) images.delete(images.keys().next().value);
      const image = new Image();
      image.onload = () => { if (!destroyed && visible) { dirty = true; scene.requestRender(); } };
      image.src = uri;
      images.set(uri, image);
    }
    return images.get(uri);
  }

  function projectTrack(vertices, width) {
    let part = [];
    const parts = [];
    for (const vertex of vertices) {
      const point = scene.mode !== SceneMode.SCENE3D || horizon.isPointVisible(vertex)
        ? SceneTransforms.worldToWindowCoordinates(scene, vertex, projected) : null;
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        part = [];
        continue;
      }
      if (scene.mode === SceneMode.SCENE2D && part.length && Math.abs(part.at(-1).x - point.x) > width / 2) part = [];
      part.push({ x: point.x, y: point.y });
      if (part.length === 2) parts.push(part);
    }
    return parts;
  }

  function frame() {
    if (!visible || destroyed) return;
    const { camera } = viewer;
    const { clientWidth: width, clientHeight: height } = scene.canvas;
    if (!width || !height) return;
    const altitude = camera.positionCartographic.height;
    if (altitude > MAX_EVENT_ALTITUDE) {
      canvas.hidden = true;
      hits = [];
      markers = [];
      screenTracks = [];
      lastFrame = '';
      return;
    }
    canvas.hidden = false;
    const ratio = eventOverlayPixelRatio(width, height, window.devicePixelRatio);
    const key = [width, height, ratio, scene.mode, camera.positionWC.x, camera.positionWC.y,
      camera.positionWC.z, camera.directionWC.x, camera.directionWC.y, camera.directionWC.z,
      camera.upWC.x, camera.upWC.y, camera.upWC.z, camera.frustum.fov, camera.frustum.width].join('|');
    const stamp = now(), animation = selected && !reduced();
    if (!dirty && lastFrame === key) {
      if (!animation || !markers.some(marker => marker.selected)) return;
      if (stamp - lastPaint < 30) { scene.requestRender(); return; }
    }
    if (dirty || lastFrame !== key) {
      lastFrame = key;
      horizon.cameraPosition = camera.positionWC;
      screenTracks = worldTracks.map(({ kind, vertices }) => ({ kind, parts: projectTrack(vertices, width) }));
      const points = [];
      for (const entry of entries) {
        if (scene.mode === SceneMode.SCENE3D && !horizon.isPointVisible(entry.world)) continue;
        const p = SceneTransforms.worldToWindowCoordinates(scene, entry.world, projected);
        if (!p || p.x < 0 || p.x > width || p.y < 0 || p.y > height) continue;
        points.push({ ...entry, x: p.x, y: p.y });
      }
      markers = clusterProjectedEvents(points, altitude > 8e6 ? 38 : altitude > 3e5 ? 31 : 13, selected);
      for (const marker of markers) marker.size = marker.selected ? 52 : marker.ids.length > 1 ? 40 : altitude > 8e6 ? 34 : 38;
      const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      dirty = false;
    }
    lastPaint = stamp;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (screenTracks.length) drawTracks(context, screenTracks);
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    const obstacles = markers.map(({ x, y, size }) => ({ left:x-size*.39, right:x+size*.39, top:y-size*.39, bottom:y+size*.39 }));
    hits = [];
    for (const marker of markers) {
      const { x, y, size, ids, report } = marker;
      const color = styleFor(report.category).color;
      if (marker.selected) {
        const cyclone = report.category === 'cyclone';
        const quake = report.category === 'earthquake';
        const wave = animation ? 0.5 + 0.5 * Math.sin(stamp / (quake ? 370 : 530)) : 0.35;
        const start = cyclone && animation ? stamp / 1000 : 0;
        context.beginPath();
        context.arc(x, y, 23 + wave * 4, start, start + Math.PI * (cyclone && animation ? 1.65 : 2));
        context.lineWidth = 2;
        context.strokeStyle = color;
        context.globalAlpha = 0.88 - wave * 0.32;
        context.stroke();
        context.globalAlpha = 1;
      }
      const sprite = asset(ids.length > 1 ? clusterIcon(ids.length, report.category) : eventIcon(report.category));
      if (sprite.complete && sprite.naturalWidth) context.drawImage(sprite, x-size/2, y-size/2, size, size);
      else {
        context.fillStyle = color;
        context.beginPath();
        context.arc(x, y, 6, 0, Math.PI * 2);
        context.fill();
      }
      hits.push({ x, y, radius: Math.max(16, size * .43), ids, selected: marker.selected });
    }
    let budget = width < 620 ? 8 : 18;
    for (const marker of [...markers].sort((a, b) => Number(Boolean(b.selected)) - Number(Boolean(a.selected)))) {
      if (marker.ids.length !== 1 || (!marker.selected && (budget <= 0
        || (altitude > 9e6 && (priority[marker.report.category] ?? 9) > 1)))) continue;
      context.font = `600 ${marker.selected ? 14 : 12}px Inter, system-ui, sans-serif`;
      const textKey = `${context.font}|${width}|${marker.report.title}`;
      let metrics = sizes.get(textKey);
      if (!metrics) {
        let label = String(marker.report.title).slice(0, 76);
        const limit = Math.min(width * .66, marker.selected ? 290 : 210);
        while (label.length > 3 && context.measureText(label).width > limit - 17) label = label.slice(0, -1);
        if (label !== marker.report.title) label = `${label.slice(0, -1)}…`;
        metrics = { label, width: Math.ceil(context.measureText(label).width) + 16 };
        if (sizes.size >= 280) sizes.clear();
        sizes.set(textKey, metrics);
      }
      const choices = labelBox(marker, width, height, metrics.width);
      const box = choices.find(candidate => !obstacles.some(other => overlap(candidate, other))) || (marker.selected ? choices[0] : null);
      if (!box) continue;
      obstacles.push(box);
      drawLabel(context, box, metrics.label, styleFor(marker.report.category).color, marker.selected);
      hits.push({ box, ids: marker.ids, selected: marker.selected });
      if (!marker.selected) budget--;
    }
    if (animation && markers.some(marker => marker.selected)) scene.requestRender();
  }

  return {
    update(groups, selectedId, show) {
      if (groups !== groupInput) {
        entries = groups.filter(group => group.position).map(group => ({
          ...group, world: Cartesian3.fromDegrees(group.position[0], group.position[1], 1200),
        })).sort((a, b) => (priority[a.report.category] ?? 9) - (priority[b.report.category] ?? 9)
          || (b.anchor?.at ?? 0) - (a.anchor?.at ?? 0) || a.id.localeCompare(b.id));
        groupInput = groups;
      }
      visible = show;
      selected = selectedId;
      canvas.hidden = !show;
      hits = [];
      dirty = true;
      if (show && !offRender) offRender = scene.postRender.addEventListener(frame);
      if (!show && offRender) { offRender(); offRender = undefined; markers = []; }
    },
    setTracks(id, tracks) {
      trackReportId = id;
      worldTracks = tracks.map(({ kind, points }) => ({ kind, vertices: trackVertices(points, scene.globe.ellipsoid) }));
      screenTracks = [];
      dirty = true;
    },
    pick(point) {
      const matching = hits.filter(hit => hit.box
        ? point.x >= hit.box.left && point.x <= hit.box.right && point.y >= hit.box.top && point.y <= hit.box.bottom
        : Math.hypot(point.x - hit.x, point.y - hit.y) <= hit.radius);
      const ids = matching.findLast(hit => hit.selected)?.ids ?? matching.at(-1)?.ids;
      if (ids) return ids;
      if (trackReportId && screenTracks.some(track => track.parts.some(part =>
        part.some((vertex, index) => index > 0 && isNearSegment(point, part[index - 1], vertex))))) return [trackReportId];
      return undefined;
    },
    diagnostics() {
      return { markers: markers.length, clusters: markers.filter(marker => marker.ids.length > 1).length,
        ratio: canvas.width / (scene.canvas.clientWidth || 1),
        positions: markers.map(({ x, y, ids }) => ({ x, y, ids })) };
    },
    destroy() {
      destroyed = true;
      offRender?.();
      canvas.remove();
      images.clear();
      sizes.clear();
      entries = markers = hits = worldTracks = screenTracks = [];
    },
  };
}
