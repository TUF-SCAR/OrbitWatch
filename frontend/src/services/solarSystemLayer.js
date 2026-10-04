import { ArcType, BoundingSphere, CallbackPositionProperty, CallbackProperty, Cartesian2, Cartesian3, Color, ConstantPositionProperty, DistanceDisplayCondition, HeadingPitchRange, HorizontalOrigin, JulianDate, LabelStyle, Material, Matrix3, Matrix4, Model, PolylineCollection, SceneTransforms, ScreenSpaceEventHandler, ScreenSpaceEventType, VerticalOrigin } from "cesium";
import { ALL_CELESTIAL_IDS, CELESTIAL_BODIES } from "../data/celestialBodies.js";
import { AU_METERS, bodyLocalTransform, bodyPositionFixed, inertialToFixedMatrix, sampleBodyOrbitFixed } from "../data/solarSystemEphemeris.js";
import { MAX_SOLAR_RANGE, SOLAR_OVERVIEW_IDS, distanceFade, solarSystemLod, solarSystemScales } from "./solarSystemLod.js";
import { createSolarSurface } from "./solarSurface.js";
import { prefersReducedMotion } from "../utils/motionPreferences.js";

export function pickSolarSystemObject(scene, position, wide) {
  if (!wide) return scene.pick(position);
  // Paths can cover their body's point. Keep this GPU query bounded and only
  // use it on explicit clicks; normal Earth/satellite picks stay unchanged.
  const picks = scene.drillPick(position, 12);
  return picks.find((item) => item?.id?.properties?.celestialId) || picks[0];
}

// Only the destination and (for moons) its parent own GPU model resources.
export function createSolarSystemLayer(viewer, options = {}) {
  const placeholders = new Map();
  const details = new Map();
  const pending = new Map();
  const timers = new Map();
  const readiness = new Map();
  // No textures or frame updates; shared across Sun retries, released with layer.
  let solarSurface;
  let selectedId = "earth", destroyed = false, generation = 0, lastUpdate = 0;
  const orbits = new Map();
  const orbitGroups = new Map();
  let scales = solarSystemScales("earth"), lod = solarSystemLod(scales, 0), markerId = null, lastLod = 0;
  let travelling = false, localBody = null, finishFlight = null;
  let localView = null, drag = null;
  const controller = viewer.scene.screenSpaceCameraController;
  const originalBounds = [controller.minimumZoomDistance, controller.maximumZoomDistance];
  const originalFar = viewer.camera.frustum?.far;
  const alive = () => !destroyed && !viewer.isDestroyed();
  const delay = (ms) => new Promise((resolve) => { const timer = window.setTimeout(() => { timers.delete(timer); resolve(false); }, ms); timers.set(timer, resolve); });
  const positionOf = (id) => id === "earth" ? Cartesian3.ZERO : bodyPositionFixed(id, viewer.clock.currentTime, new Cartesian3());
  const framingScale = (id) => CELESTIAL_BODIES[id].rings ? Math.max(7, Math.max(...CELESTIAL_BODIES[id].rings) * 3) : 5.5;
  const matrixOf = (id) => Matrix4.fromTranslation(positionOf(id), new Matrix4());

  for (const id of ALL_CELESTIAL_IDS) {
    const body = CELESTIAL_BODIES[id];
    const radius = Math.max(100, body.radiusKm * 1000);
    const position = new ConstantPositionProperty(positionOf(id) || Cartesian3.ZERO);
    const leaderPoints = [new Cartesian3(), new Cartesian3()], leaderScreen = new Cartesian2(), leaderRelative = new Cartesian3();
    const entity = viewer.entities.add({ id: `celestial-${id}`, name: body.name, position, show: id !== "earth", properties: { celestialId: id },
      ellipsoid: { radii: new Cartesian3(radius, radius, radius), material: Color.fromCssColorString(body.color), stackPartitions: 8, slicePartitions: 12, distanceDisplayCondition: new DistanceDisplayCondition(0, radius * 60) },
      point: { pixelSize: body.type === "Star" ? 8 : 5, color: Color.fromCssColorString(body.color), distanceDisplayCondition: new DistanceDisplayCondition(radius * 60, Number.MAX_VALUE) },
      label: { show: false, horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.CENTER, text: body.name, font: "600 14px Inter, sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -20) },
      // Screen annotations connect displaced labels to the real body position.
      // Two reused points, independent of the sampled orbital paths above.
      polyline: { show: false, width: 1, arcType: ArcType.NONE, material: Color.fromCssColorString(body.color).withAlpha(0.22), positions: new CallbackProperty((time) => {
        bodyPositionFixed(id, time, leaderPoints[0]);
        const screen = SceneTransforms.worldToWindowCoordinates(viewer.scene, leaderPoints[0], leaderScreen);
        const offset = entity.label.pixelOffset.getValue(time);
        if (!screen) { Cartesian3.clone(leaderPoints[0], leaderPoints[1]); return leaderPoints; }
        screen.x += offset.x; screen.y += offset.y + 8;
        const ray = viewer.camera.getPickRay(screen);
        const depth = Cartesian3.dot(Cartesian3.subtract(leaderPoints[0], viewer.camera.positionWC, leaderRelative), viewer.camera.directionWC);
        const denominator = ray && Cartesian3.dot(ray.direction, viewer.camera.directionWC);
        if (depth > 0 && denominator > 0) Cartesian3.add(ray.origin, Cartesian3.multiplyByScalar(ray.direction, depth / denominator, leaderPoints[1]), leaderPoints[1]);
        else Cartesian3.clone(leaderPoints[0], leaderPoints[1]);
        return leaderPoints;
      }, false) },
    });
    placeholders.set(id, { entity, position, radius });
  }
  function removeDetail(id) {
    readiness.get(id)?.(false);
    const model = details.get(id);
    if (model && alive()) viewer.scene.primitives.remove(model);
    details.delete(id);
    if (id !== "earth" && placeholders.has(id)) { const item = placeholders.get(id); item.entity.show = true; item.entity.ellipsoid.show = true; item.entity.point.show = true; }
  }
  function setSelected(id) {
    selectedId = CELESTIAL_BODIES[id] ? id : "earth";
    for (const [key, item] of placeholders) {
      const active = key === selectedId;
      item.entity.label.show = active;
      // The entity primitive's distance cutoff can wrongly cull a tiny body
      // at AU-scale coordinates. Keep the selected fallback visible; only
      // this one body bypasses the general distance-based detail limit.
      item.entity.ellipsoid.distanceDisplayCondition = active ? undefined : new DistanceDisplayCondition(0, item.radius * 60);
    }
    markerId = null;
    scales = solarSystemScales(selectedId);
    // Keep major paths reusable; retain only this destination's local paths.
    const wanted = new Set([...SOLAR_OVERVIEW_IDS, selectedId, ...scales.family]);
    for (const [key, item] of orbits) if (!wanted.has(key)) { viewer.entities.remove(item.entity); orbitGroups.get(item.center).remove(item.line); orbits.delete(key); }
    for (const [center, group] of orbitGroups) if (!group.length) { viewer.scene.primitives.remove(group); orbitGroups.delete(center); }
    ensureOrbit(selectedId);
    for (const key of scales.family) if (CELESTIAL_BODIES[key].type === "Moon") ensureOrbit(key);
    syncLocalEntities();
  }
  function ensureOrbit(id) {
    if (id === "sun" || orbits.has(id)) return;
    const center = CELESTIAL_BODIES[id].type === "Moon" ? CELESTIAL_BODIES[id].parent : "sun";
    const item = { center, sampledAt: null, evaluatedAt: null, vectors: [], points: [] };
    // Sample 96 segments only when scene time changes substantially. Camera
    // movement only changes styling; it never re-samples orbital elements.
    // Reuse the output array and vectors. Same-time rotation/translation keeps
    // every orbit in the existing inertial local camera frame.
    item.sample = (time) => {
      if (!item.sampledAt || Math.abs(JulianDate.secondsDifference(time, item.sampledAt)) > 60) {
        const origin = bodyPositionFixed(center, time);
        const inverse = Matrix3.transpose(inertialToFixedMatrix(time), new Matrix3());
        item.vectors = sampleBodyOrbitFixed(id, time, 96).map((point) => Matrix3.multiplyByVector(inverse, Cartesian3.subtract(point, origin, point), point));
        item.points = item.vectors.map(() => new Cartesian3());
        item.sampledAt = JulianDate.clone(time);
        item.evaluatedAt = null;
        if (item.line) item.line.positions = item.vectors;
      }
    };
    const positions = new CallbackProperty((time) => {
      item.sample(time);
      if (!item.evaluatedAt || !JulianDate.equals(time, item.evaluatedAt)) {
        const rotation = inertialToFixedMatrix(time), origin = bodyPositionFixed(center, time);
        for (let i = 0; i < item.vectors.length; i++) Cartesian3.add(Matrix3.multiplyByVector(rotation, item.vectors[i], item.points[i]), origin, item.points[i]);
        item.evaluatedAt = JulianDate.clone(time, item.evaluatedAt);
      }
      return item.points;
    }, false);
    // Retain the world-space entity/data interface, but render static inertial
    // vertices in parent-centred collections. Updating a group's matrix moves
    // all its paths without rebuilding geometry on ticks or camera gestures.
    item.entity = viewer.entities.add({ id: `celestial-orbit-${id}`, show: false, polyline: { show: false, positions, arcType: ArcType.NONE, width: 1, material: Color.fromCssColorString(CELESTIAL_BODIES[id].color).withAlpha(0.24) } });
    let group = orbitGroups.get(center);
    if (!group) { group = viewer.scene.primitives.add(new PolylineCollection()); orbitGroups.set(center, group); }
    item.sample(viewer.clock.currentTime);
    item.line = group.add({ id: item.entity, show: false, positions: item.vectors, width: 1, material: Material.fromType("Color", { color: Color.fromCssColorString(CELESTIAL_BODIES[id].color).withAlpha(0.24) }) });
    orbits.set(id, item);
  }
  function syncLocalEntities() {
    for (const [id, item] of placeholders) {
      // Visible markers, local siblings and models share the render timestamp.
      item.entity.position = new CallbackPositionProperty((time, result) => bodyPositionFixed(id, time, result), false);
    }
    lastLod = 0;
  }
  function updateLod(force = false) {
    if (travelling) return;
    const now = performance.now();
    if (!force && now - lastLod < 100) return;
    lastLod = now;
    const range = localView?.range ?? Cartesian3.distance(viewer.camera.positionWC, positionOf(selectedId));
    const reduced = prefersReducedMotion(), live = options.isLive?.() ?? true;
    lod = solarSystemLod(scales, range, reduced);
    if (!live) lod = { local: 0, solar: 0, overview: 0, stage: "close" };
    // Cesium's terrestrial far plane clips AU-scale context. Extend the existing
    // frustum with camera scale, or valid AU-scale markers/paths are clipped.
    // Normal Earth framing retains its original frustum and native controls.
    if (originalFar) viewer.camera.frustum.far = range < scales.localStart && lod.solar === 0 ? originalFar
      : Math.max(originalFar, range * 2 + (lod.solar > 0 ? Math.max(35 * AU_METERS, scales.solarEnd * 3) : scales.localEnd * 3));
    if (lod.solar > 0) ensureOrbit(scales.parent);
    if (lod.overview > 0) for (const key of SOLAR_OVERVIEW_IDS) ensureOrbit(key);
    const origin = positionOf(selectedId);
    for (const [id, item] of placeholders) {
      const family = scales.family.includes(id), active = id === selectedId, highlighted = id === markerId;
      const distance = id === selectedId && localView ? localView.range : Cartesian3.distance(viewer.camera.positionWC, positionOf(id));
      const nearby = Cartesian3.distance(origin, positionOf(id)) < range * 1.8;
      const major = SOLAR_OVERVIEW_IDS.includes(id);
      const contextAlpha = major ? Math.max(lod.overview, nearby ? lod.solar : 0) : 0;
      // A parent is already useful in a close moon view. Other local bodies
      // remain spatially present; their labels/orbits emerge at system scale.
      const relevant = active || family && scales.parent !== "sun";
      const localAlpha = active ? 1 : relevant ? 1 - lod.solar : 0;
      const alpha = Math.max(localAlpha, contextAlpha);
      const symbolic = distanceFade(distance, item.radius * 20, item.radius * 60, reduced);
      const ready = details.get(id)?.ready;
      const earthSurface = id === "earth" && viewer.scene.globe?.show;
      item.entity.show = alpha > 0.01 && (live || relevant && selectedId !== "earth");
      item.entity.ellipsoid.show = !ready && !earthSurface && symbolic < 1;
      item.entity.point.show = symbolic > 0.01;
      item.entity.point.distanceDisplayCondition = undefined;
      item.entity.point.pixelSize = highlighted || active ? 10 : id === "sun" ? 9 : 7;
      item.entity.point.color = Color.fromCssColorString(CELESTIAL_BODIES[id].color).withAlpha(alpha * symbolic);
      item.entity.point.outlineColor = highlighted ? Color.WHITE : Color.BLACK.withAlpha(0.7);
      item.entity.point.outlineWidth = highlighted ? 2 : 1;
      item.entity.label.show = alpha > 0.05 && (active && id !== "earth" || contextAlpha > 0.05 || family && lod.local > 0.05);
      const labelAlpha = relevant ? active ? 1 : Math.max(lod.local * (1 - lod.solar), contextAlpha) : contextAlpha;
      item.entity.label.fillColor = Color.WHITE.withAlpha(labelAlpha);
      item.entity.label.outlineColor = Color.BLACK.withAlpha(labelAlpha);
      // Stagger inner-planet names where real AU coordinates converge on screen.
      const index = SOLAR_OVERVIEW_IDS.indexOf(id);
      item.entity.label.pixelOffset = contextAlpha > 0 && index >= 0 ? new Cartesian2(index % 2 ? 24 : -24, -18 - index % 5 * 18) : new Cartesian2(0, -20);
      const model = details.get(id);
      if (model?.ready) model.show = distance < item.radius * 100;
    }
    for (const [id, item] of orbits) {
      const moon = CELESTIAL_BODIES[id].type === "Moon";
      const selectedSolar = id === scales.parent || id === selectedId && !moon;
      const alpha = moon ? (id === selectedId ? 0.24 : lod.local * 0.16) * (1 - lod.solar)
        : selectedSolar ? lod.solar * 0.32 : SOLAR_OVERVIEW_IDS.includes(id) ? lod.overview * 0.10 : 0;
      item.entity.show = alpha > 0.005 && (live || moon && id === selectedId);
      const color = Color.fromCssColorString(CELESTIAL_BODIES[id].color).withAlpha(alpha);
      item.entity.polyline.material = color;
      item.line.show = item.entity.show;
      item.line.material.uniforms.color = color;
    }
    layoutLabels();
    for (const item of placeholders.values()) {
      const entity = item.entity, offset = entity.label.pixelOffset.getValue();
      const screen = viewer.scene.camera && entity.show && SceneTransforms.worldToWindowCoordinates(viewer.scene, positionOf(entity.properties.celestialId.getValue()));
      const onScreen = screen && screen.x >= 0 && screen.x <= viewer.scene.canvas.clientWidth && screen.y >= 0 && screen.y <= viewer.scene.canvas.clientHeight;
      entity.polyline.show = Boolean(onScreen && entity.label.show.getValue() && entity.point.show.getValue() && Math.hypot(offset.x, offset.y) > 32);
      entity.polyline.material = Color.fromCssColorString(CELESTIAL_BODIES[entity.properties.celestialId.getValue()].color).withAlpha(entity.label.fillColor.getValue().alpha * 0.22);
    }
  }
  function layoutLabels() {
    if (!viewer.scene.camera) return; // Headless lifecycle harness.
    const occupied = [], width = viewer.scene.canvas.clientWidth, height = viewer.scene.canvas.clientHeight;
    const ids = [...placeholders.keys()].sort((a, b) => (a === markerId ? -3 : a === selectedId ? -2 : a === scales.parent ? -1 : 0) - (b === markerId ? -3 : b === selectedId ? -2 : b === scales.parent ? -1 : 0));
    for (const id of ids) {
      const entity = placeholders.get(id).entity;
      if (!entity.show || !entity.label.show.getValue()) continue;
      const screen = SceneTransforms.worldToWindowCoordinates(viewer.scene, positionOf(id));
      if (!screen || screen.x < 0 || screen.x > width || screen.y < 0 || screen.y > height) continue;
      const halfWidth = CELESTIAL_BODIES[id].name.length * 4.5 + 5;
      for (let row = 0; row < 24; row++) {
        const offset = new Cartesian2(row % 3 === 1 ? halfWidth + 14 : row % 3 === 2 ? -halfWidth - 14 : 0, -22 - Math.floor(row / 3) * 24);
        const x = screen.x + offset.x, y = screen.y + offset.y;
        const box = { left: x - halfWidth, right: x + halfWidth, top: y - 10, bottom: y + 10 };
        if (box.left < 8 || box.right > width - 8 || box.top < 80 || box.bottom > height - 100) continue;
        if (occupied.some((other) => box.left < other.right + 5 && box.right > other.left - 5 && box.top < other.bottom + 4 && box.bottom > other.top - 4)) continue;
        occupied.push(box);
        entity.label.pixelOffset = offset;
        break;
      }
    }
  }
  function loadDetail(id, token) {
    if (id === "earth") return Promise.resolve(true);
    if (details.get(id)?.ready) return Promise.resolve(true);
    if (pending.get(id)?.token === token) return pending.get(id).promise;
    const item = placeholders.get(id);
    const promise = (async () => {
      let model;
      try {
        // Cesium owns download, decode and upload: no speculative duplicate fetch.
        if (id === "sun") solarSurface ||= createSolarSurface();
        model = await Model.fromGltfAsync({ url: `/models/celestial/${id}.glb`, modelMatrix: matrixOf(id), scale: item.radius, show: false, incrementallyLoadTextures: false, allowPicking: true, id: item.entity, customShader: id === "sun" ? solarSurface : undefined });
        if (!alive() || token !== generation) { model.destroy(); return false; }
        details.set(id, model);
        viewer.scene.primitives.add(model);
        return await new Promise((resolve) => {
          let settled = false;
          const done = (ok) => { if (settled) return; settled = true; offReady?.(); offError?.(); readiness.delete(id); resolve(ok); };
          const offReady = model.readyEvent.addEventListener(() => {
            if (!alive() || token !== generation) { done(false); return; }
            model.show = true;
            item.entity.ellipsoid.show = false;
            item.entity.point.show = false;
            options.onDetailReady?.(id);
            viewer.scene.requestRender();
            done(true);
          });
          const offError = model.errorEvent.addEventListener(() => done(false));
          readiness.set(id, done);
          // Travel has its own ten-second UI deadline. Keep this listener alive
          // so late GPU uploads can replace the placeholder without another trip.
          delay(30000).then(() => { if (!settled) removeDetail(id); });
          viewer.scene.requestRender();
        });
      } catch { if (model && alive() && details.get(id) === model) removeDetail(id); return false; }
      finally { if (pending.get(id)?.promise === promise) pending.delete(id); }
    })();
    pending.set(id, { promise, token });
    return promise;
  }
  function releaseLocal() {
    localBody = null;
    localView = null;
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    [controller.minimumZoomDistance, controller.maximumZoomDistance] = originalBounds;
    controller.enableTranslate = true;
    syncLocalEntities();
  }
  function bindLocal(id) {
    if (id === "earth") return;
    localBody = id;
    const radius = placeholders.get(id).radius;
    // Anchor the inertial axes to the arrival frame so binding does not rotate
    // the completed flight. Subsequent Earth rotation cancels in this frame.
    const basis = Matrix3.transpose(inertialToFixedMatrix(viewer.clock.currentTime), new Matrix3());
    const modelRotations = new Map([...details].map(([key, model]) => [key, Matrix4.getMatrix3(model.modelMatrix, new Matrix3())]));
    localView = { heading: 0.28, pitch: -0.24, range: radius * framingScale(id), pan: new Cartesian3(), basis, modelRotations };
    controller.enableInputs = false;
    controller.minimumZoomDistance = radius * 1.08;
    controller.maximumZoomDistance = MAX_SOLAR_RANGE;
    controller.enableTranslate = true;
    syncLocalEntities();
  }
  function updatePositions(force = false) {
    if (!alive()) return;
    const now = performance.now();
    const updateAll = force || now - lastUpdate > 1000;
    if (updateAll) {
      lastUpdate = now;
    }
    const transform = localBody && !travelling ? bodyLocalTransform(localBody, viewer.clock.currentTime, localView.basis) : null;
    const rotation = transform ? Matrix4.getMatrix3(transform, new Matrix3()) : null;
    for (const [id, item] of placeholders) {
      if (!updateAll && !details.has(id) && id !== localBody) continue;
      const pos = positionOf(id);
      if (!pos) continue;
      item.position.setValue(pos);
      const model = details.get(id);
      if (model && !model.isDestroyed()) {
        // Surfaces/rings share the local inertial axes. On departure retain
        // their last orientation while the existing world-space flight runs.
        const orientation = rotation ? Matrix3.multiply(rotation, localView.modelRotations.get(id) || Matrix3.IDENTITY, new Matrix3()) : Matrix4.getMatrix3(model.modelMatrix, new Matrix3());
        model.modelMatrix = Matrix4.fromRotationTranslation(orientation, pos, new Matrix4());
      }
    }
    if (localBody && !travelling) {
      const target = Matrix4.multiplyByPoint(transform, localView.pan, new Cartesian3());
      Matrix4.setTranslation(transform, target, transform);
      viewer.camera.lookAtTransform(transform, new HeadingPitchRange(localView.heading, localView.pitch, localView.range));
    }
    updateLod(force);
    // At most two groups: heliocentric paths and this destination's moon
    // system. Hidden paths keep their vertices; scene-time updates only change
    // the shared inertial-to-fixed/parent translation matrices.
    for (const [center, group] of orbitGroups) group.modelMatrix = Matrix4.fromRotationTranslation(inertialToFixedMatrix(viewer.clock.currentTime), positionOf(center), group.modelMatrix);
    for (const item of orbits.values()) if (item.entity.show) item.sample(viewer.clock.currentTime);
  }
  const localHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  const endDrag = () => { drag = null; };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("blur", endDrag);
  localHandler.setInputAction(() => { if (localBody && !travelling) drag = "orbit"; }, ScreenSpaceEventType.LEFT_DOWN);
  localHandler.setInputAction(() => { if (localBody && !travelling) drag = "pan"; }, ScreenSpaceEventType.RIGHT_DOWN);
  localHandler.setInputAction(() => { drag = null; }, ScreenSpaceEventType.LEFT_UP);
  localHandler.setInputAction(() => { drag = null; }, ScreenSpaceEventType.RIGHT_UP);
  localHandler.setInputAction((movement) => {
    if (!localView || !drag || travelling) return;
    const dx = movement.endPosition.x - movement.startPosition.x, dy = movement.endPosition.y - movement.startPosition.y;
    const radius = placeholders.get(localBody).radius;
    if (drag === "orbit") { localView.heading += dx * 0.004; localView.pitch = Math.max(-1.45, Math.min(1.45, localView.pitch - dy * 0.004)); }
    else {
      const right = Cartesian3.multiplyByScalar(viewer.camera.right, -dx * localView.range / 1200, new Cartesian3());
      const up = Cartesian3.multiplyByScalar(viewer.camera.up, dy * localView.range / 1200, new Cartesian3());
      Cartesian3.add(localView.pan, Cartesian3.add(right, up, right), localView.pan);
      const length = Cartesian3.magnitude(localView.pan);
      if (length > radius * 2) Cartesian3.multiplyByScalar(localView.pan, radius * 2 / length, localView.pan);
    }
    viewer.scene.requestRender();
  }, ScreenSpaceEventType.MOUSE_MOVE);
  localHandler.setInputAction((delta) => {
    if (!localView || travelling) return;
    const radius = placeholders.get(localBody).radius;
    localView.range = Math.max(radius * 1.15, Math.min(MAX_SOLAR_RANGE, localView.range * Math.exp(-delta * 0.0015)));
    viewer.scene.requestRender();
  }, ScreenSpaceEventType.WHEEL);
  const offTick = viewer.clock.onTick.addEventListener(() => updatePositions());
  async function focus(id = "earth") {
    if (!alive() || travelling || !placeholders.has(id)) return { cancelled: true };
    const reduced = prefersReducedMotion();
    const previous = { id: selectedId, localBody, localView, position: Cartesian3.clone(viewer.camera.positionWC), direction: Cartesian3.clone(viewer.camera.directionWC), up: Cartesian3.clone(viewer.camera.upWC) };
    travelling = true;
    const resumeClock = viewer.clock.shouldAnimate;
    const resumeClockStep = viewer.clock.clockStep;
    viewer.clock.shouldAnimate = false;
    const token = ++generation;
    const started = performance.now();
    try {
      setSelected(id);
      viewer.trackedEntity = undefined;
      viewer.camera.cancelFlight();
      releaseLocal();
      controller.enableInputs = false;
      const wanted = new Set(id === "earth" ? [] : [id, ...(CELESTIAL_BODIES[id].type === "Moon" ? [CELESTIAL_BODIES[id].parent] : [])]);
      const detailPromise = Promise.all([...wanted].map((key) => loadDetail(key, token))).then((results) => results.every(Boolean));
      // Allow the interface to fade while the destination starts streaming.
      await delay(reduced ? 0 : 700);
      if (!alive() || token !== generation) return { cancelled: true };
      const obsolete = [...details.keys()].filter((key) => !wanted.has(key));
      for (const [key, item] of placeholders) { item.entity.ellipsoid.show = !details.get(key)?.ready; item.entity.point.show = !details.get(key)?.ready; }
      const atEarth = id === "earth" || CELESTIAL_BODIES[id].parent === "earth";
      if (atEarth) { placeholders.get("earth").entity.show = false; options.showEarthDetail?.(); }
      updatePositions(true);
      const target = positionOf(id);
      const radius = placeholders.get(id).radius;
      const distance = Cartesian3.distance(viewer.camera.positionWC, target);
      const duration = reduced ? 0 : Math.min(5.5, Math.max(1.3, Math.log10(Math.max(distance, 1) / Math.max(radius, 1) + 1) * 0.75));
      const releaseOrigin = () => {
        if (!alive() || token !== generation) return;
        for (const key of obsolete) removeDetail(key);
        if (!atEarth) { options.hideEarthDetail?.(); placeholders.get("earth").entity.show = true; }
      };
      // Retain the departure surface until the camera is moving away from it.
      delay(Math.min(700, duration * 300)).then(releaseOrigin);
      await new Promise((resolve) => {
        finishFlight = resolve;
        viewer.camera.flyToBoundingSphere(new BoundingSphere(target, radius), { duration, offset: new HeadingPitchRange(0.28, -0.24, radius * framingScale(id)), complete: resolve, cancel: resolve });
      });
      finishFlight = null;
      releaseOrigin();
      const ready = await Promise.race([detailPromise, delay(Math.max(1, 10000 - (performance.now() - started)))]);
      if (!alive() || token !== generation) return { cancelled: true };
      bindLocal(id);
      if (!ready) {
        // Retry only this destination, once; UI remains interactive on its placeholder.
        delay(15000).then(() => {
          if (!alive() || token !== generation) return;
          for (const key of wanted) if (!details.get(key)?.ready) { removeDetail(key); pending.delete(key); loadDetail(key, token); }
        });
      }
      return { handled: true, degraded: !ready, duration };
    } catch (error) {
      if (!alive()) return { cancelled: true };
      // A failed flight must not leave the rendered destination and HUD apart.
      // Invalidate its downloads and delayed origin-release callback first.
      generation += 1;
      finishFlight = null;
      viewer.camera.cancelFlight();
      releaseLocal();
      setSelected(previous.id);
      const restored = new Set(previous.id === "earth" ? [] : [previous.id, ...(CELESTIAL_BODIES[previous.id].type === "Moon" ? [CELESTIAL_BODIES[previous.id].parent] : [])]);
      for (const key of details.keys()) if (!restored.has(key) || !details.get(key)?.ready) removeDetail(key);
      const earthVisible = previous.id === "earth" || CELESTIAL_BODIES[previous.id].parent === "earth";
      placeholders.get("earth").entity.show = !earthVisible;
      if (earthVisible) options.showEarthDetail?.(); else options.hideEarthDetail?.();
      viewer.camera.setView({ destination: previous.position, orientation: { direction: previous.direction, up: previous.up } });
      localBody = previous.localBody;
      localView = previous.localView;
      syncLocalEntities();
      const degraded = [...restored].some((key) => key !== "earth" && !details.get(key)?.ready);
      for (const key of restored) loadDetail(key, generation);
      updatePositions(true);
      viewer.scene.requestRender();
      console.warn("OrbitWatch: celestial travel restored previous view", error);
      return { handled: false, error: true, degraded };
    } finally {
      travelling = false;
      if (alive()) {
        if (resumeClock) viewer.clock.currentTime = JulianDate.now();
        viewer.clock.shouldAnimate = resumeClock;
        if (resumeClock) viewer.clock.clockStep = resumeClockStep;
        controller.enableInputs = !localBody;
        // Bind the settled local frame after restoring the clock, including
        // failed flights in paused Time mode. An earlier render request can
        // be consumed while travelling still suppresses the local camera.
        updatePositions(true);
        viewer.scene.requestRender();
      }
    }
  }
  function destroy() {
    if (destroyed) return;
    generation += 1;
    offTick();
    if (originalFar && alive()) viewer.camera.frustum.far = originalFar;
    localHandler.destroy();
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("blur", endDrag);
    finishFlight?.();
    for (const [timer, resolve] of timers) { window.clearTimeout(timer); resolve(false); }
    timers.clear();
    for (const id of details.keys()) removeDetail(id);
    solarSurface?.destroy();
    for (const item of orbits.values()) if (alive()) viewer.entities.remove(item.entity);
    orbits.clear();
    for (const group of orbitGroups.values()) if (alive()) viewer.scene.primitives.remove(group);
    orbitGroups.clear();
    for (const item of placeholders.values()) if (alive()) viewer.entities.remove(item.entity);
    destroyed = true;
    placeholders.clear(); pending.clear();
  }
  return { focus, setSelected, updatePositions,
    selectMarker: (id) => { markerId = placeholders.has(id) ? id : null; updateLod(true); viewer.scene.requestRender(); },
    isWide: () => lod.solar > 0,
    follow: (id) => { if (!travelling && id === selectedId) { bindLocal(id); return true; } return false; }, destroy };
}
