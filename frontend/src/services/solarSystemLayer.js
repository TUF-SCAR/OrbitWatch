import { ArcType, BoundingSphere, CallbackPositionProperty, CallbackProperty, Cartesian2, Cartesian3, Color, CustomDataSource, HeadingPitchRange, JulianDate, Material, Matrix3, Matrix4, Model, PolylineCollection, SceneTransforms, ScreenSpaceEventHandler, ScreenSpaceEventType } from "cesium";
import { ALL_CELESTIAL_IDS, CELESTIAL_BODIES } from "../data/celestialBodies.js";
import { AU_METERS, bodyLocalTransform, inertialToFixedMatrix, sampleBodyOrbitFixed } from "../data/solarSystemEphemeris.js";
import { MAX_SOLAR_RANGE, SOLAR_OVERVIEW_IDS, distanceFade, representationWeights, surfaceSymbolicHandoff, rangeToScale, scaleToRange, solarSystemLod, solarSystemScales } from "./solarSystemLod.js";
import { createCelestialSymbols } from "./celestialSymbols.js";
import { createCanonicalPositions } from "./canonicalCelestialPosition.js";
import { layoutCelestialLabels } from "./celestialLabelLayout.js";
import { MOTION } from "../utils/motionTokens.js";
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
  let selectedId = "earth", destroyed = false, generation = 0, lastLayout = 0, lastScale = 0;
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
  const canonicalPosition = createCanonicalPositions();
  let sceneTime = viewer.clock.currentTime, labelSlots = new Map(), scaleVisible = false, publishedScale = null, visualTime = null;
  const positionOf = (id, time = sceneTime) => canonicalPosition(id, time);
  const scaleMinimum = () => scales.localStart;
  const symbols = createCelestialSymbols(viewer.scene, positionOf);
  let earthSymbolic = false;

  const framingScale = (id) => CELESTIAL_BODIES[id].rings ? Math.max(7, Math.max(...CELESTIAL_BODIES[id].rings) * 3) : 5.5;
  const matrixOf = (id) => Matrix4.fromTranslation(positionOf(id), new Matrix4());

  for (const id of ALL_CELESTIAL_IDS) {
    const body = CELESTIAL_BODIES[id];
    const radius = Math.max(100, body.radiusKm * 1000);
    const position = new CallbackPositionProperty((time, result) => canonicalPosition(id, time, result), false);
    const entity = viewer.entities.add({ id: `celestial-${id}`, name: body.name, position, show: id !== "earth", properties: { celestialId: id },
      ellipsoid: { show: false, radii: new Cartesian3(radius, radius, radius), material: Color.fromCssColorString(body.color), stackPartitions: 8, slicePartitions: 12 },

    });
    placeholders.set(id, { entity, ...symbols.add(entity, body), radius, alpha: 0, labelAlpha: 0, symbolic: false });
  }
  function removeDetail(id) {
    readiness.get(id)?.(false);
    const model = details.get(id);
    if (model && alive()) viewer.scene.primitives.remove(model);
    details.delete(id);
    lastLod = 0;
  }
  function setSelected(id) {
    selectedId = CELESTIAL_BODIES[id] ? id : "earth";
    markerId = null;
    scales = solarSystemScales(selectedId);
    lod = solarSystemLod(scales, 0);
    labelSlots.clear();
    for (const item of placeholders.values()) { item.alpha = 0; item.labelAlpha = 0; }
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
        const origin = positionOf(center, time);
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
        const rotation = inertialToFixedMatrix(time), origin = positionOf(center, time);
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
  function syncLocalEntities() { lastLod = 0; lastLayout = 0; }
  function updateLod(force = false) {
    if (travelling) return;
    const now = performance.now();
    if (!force && now - lastLod < 32) return;
    const elapsed = Math.min(0.1, (now - lastLod) / 1000);
    lastLod = now;
    const range = localView?.range ?? Cartesian3.distance(viewer.camera.positionWC, positionOf(selectedId));
    const reduced = prefersReducedMotion(), live = options.isLive?.() ?? true;
    // Native Earth wheel zoom shares the slider's wide-scale ceiling. Restore
    // its original bounds at ordinary globe scale and outside Live Mode.
    if (!localView) controller.maximumZoomDistance = live && range >= scales.localStart ? MAX_SOLAR_RANGE : originalBounds[1];
    lod = solarSystemLod(scales, range, reduced, lod.stage);
    if (!live) lod = { local: 0, solar: 0, overview: 0, stage: "close" };
    const easeAlpha = (from, to, duration) => reduced ? to : from + (to - from) * (1 - Math.exp(-elapsed * 5 / duration));
    if (originalFar) viewer.camera.frustum.far = range < scales.localStart && lod.solar === 0 ? originalFar
      : Math.max(originalFar, range * 2 + (lod.solar > 0 ? Math.max(35 * AU_METERS, scales.solarEnd * 3) : scales.localEnd * 3));
    if (lod.solar > 0) ensureOrbit(scales.parent);
    if (lod.overview > 0) for (const key of SOLAR_OVERVIEW_IDS) ensureOrbit(key);
    const origin = positionOf(selectedId);
    for (const [id, item] of placeholders) {
      const family = scales.family.includes(id), active = id === selectedId, highlighted = id === markerId;
      const distance = id === selectedId && localView ? localView.range : Cartesian3.distance(viewer.camera.positionWC, positionOf(id));
      const major = SOLAR_OVERVIEW_IDS.includes(id);
      // Nearby bodies emerge before the whole overview. Names follow markers;
      // additional paths follow names, instead of a simultaneous label burst.
      const separation = Cartesian3.distance(origin, positionOf(id));
      const proximity = 1 - distanceFade(separation, range * 1.1, range * 2.2);
      const contextAlpha = major ? Math.max(lod.overview, proximity * lod.solar) : 0;
      const relevant = active || family && scales.parent !== "sun";
      const localAlpha = active ? 1 : relevant ? 1 - lod.solar : 0;
      const targetAlpha = live || relevant && selectedId !== "earth" ? Math.max(localAlpha, contextAlpha) : 0;
      item.alpha = active ? 1 : easeAlpha(item.alpha, targetAlpha, MOTION.marker);
      const weights = representationWeights(distance, item.radius, item.symbolic, reduced);
      const earthOwned = id === "earth" && (selectedId === "earth" || scales.parent === "earth");
      if (earthOwned) {
        earthSymbolic = live && surfaceSymbolicHandoff(distance, item.radius, viewer.scene.canvas.clientHeight || 720, viewer.camera.frustum.fovy || Math.PI / 3, earthSymbolic);
        weights.physical = Number(!earthSymbolic); weights.symbolic = Number(earthSymbolic);
      }
      item.symbolic = weights.symbolic > 0;
      const ready = details.get(id)?.ready;
      // Ordinary Earth scale contains no solar entities at all. Its existing
      // globe/imagery owns the physical phase; the point owns only the far phase.
      item.entity.show = item.alpha > 0.001 && !(selectedId === "earth" && lod.local === 0);
      item.entity.ellipsoid.show.setValue(!ready && !earthOwned && weights.physical > 0.001);
      item.entity.ellipsoid.material.color.setValue(Color.fromCssColorString(CELESTIAL_BODIES[id].color).withAlpha(item.alpha * weights.physical));
      item.point.show = item.entity.show && weights.symbolic > 0.001;
      item.point.pixelSize = highlighted || active ? 9 : 6;
      item.point.color = Color.fromCssColorString(CELESTIAL_BODIES[id].color).withAlpha(item.alpha * weights.symbolic);
      item.point.outlineColor = highlighted ? Color.WHITE.withAlpha(item.alpha * weights.symbolic) : Color.BLACK.withAlpha(item.alpha * weights.symbolic * 0.7);
      item.point.outlineWidth = highlighted ? 2 : 1;
      const delayedContext = Math.max(0, (Math.min(contextAlpha, item.alpha) - 0.22) / 0.78);
      const labelTarget = active && id !== "earth" ? item.alpha : relevant ? Math.max(lod.local * (1 - lod.solar), delayedContext) : delayedContext;
      item.labelAlpha = easeAlpha(item.labelAlpha, labelTarget, MOTION.label);
      item.labelWanted = item.entity.show && item.labelAlpha > 0.01;
      item.label.fillColor = Color.WHITE.withAlpha(item.labelAlpha);
      item.label.outlineColor = Color.BLACK.withAlpha(item.labelAlpha);
      const model = details.get(id);
      if (model?.ready) { model.show = item.entity.show && weights.physical > 0.001; model.color = Color.WHITE.withAlpha(item.alpha * weights.physical); }
      if (earthOwned) options.setEarthRepresentation?.(!live || weights.physical > 0.001);
    }
    for (const [id, item] of orbits) {
      const moon = CELESTIAL_BODIES[id].type === "Moon";
      const selectedSolar = id === scales.parent || id === selectedId && !moon;
      const target = moon ? (id === selectedId ? 0.24 : lod.local * 0.16) * (1 - lod.solar)
        : selectedSolar ? lod.solar * 0.32 : SOLAR_OVERVIEW_IDS.includes(id) ? Math.max(0, (lod.overview - 0.25) / 0.75) * 0.10 : 0;
      item.alpha = easeAlpha(item.alpha || 0, target, MOTION.lod);
      item.entity.show = item.alpha > 0.005 && (live || moon && id === selectedId);
      const color = Color.fromCssColorString(CELESTIAL_BODIES[id].color).withAlpha(item.alpha);
      item.entity.polyline.material = color;
      item.line.show = item.entity.show;
      item.line.material.uniforms.color = color;
    }
    scaleVisible = live && (scaleVisible ? range > scales.localStart * 1.5 : range > scales.localStart * 2);
    if (force || now - lastScale > 150) {
      lastScale = now;
      const value = rangeToScale(range, scaleMinimum());
      if (!publishedScale || publishedScale.visible !== scaleVisible || publishedScale.stage !== lod.stage || Math.abs(publishedScale.value - value) > 0.0005) {
        publishedScale = { visible: scaleVisible, value, range, stage: lod.stage };
        options.onScaleChange?.(publishedScale);
      }
    }
  }
  function layoutLabels() {
    if (!viewer.scene.camera) {
      for (const item of placeholders.values()) item.label.show = Boolean(item.labelWanted);
      return;
    }
    const candidates = [];
    let order = 0;
    for (const [id, item] of placeholders) {
      item.label.show = false;
      if (!item.labelWanted) continue;
      const screen = SceneTransforms.worldToWindowCoordinates(viewer.scene, positionOf(id));
      if (!screen) continue;
      const priority = id === markerId ? 0 : id === selectedId ? 1 : id === "sun" ? 2 : SOLAR_OVERVIEW_IDS.includes(id) ? 3 : scales.family.includes(id) ? 4 : 5;
      candidates.push({ id, name: CELESTIAL_BODIES[id].name, x: screen.x, y: screen.y, priority, order: order++ });
    }
    labelSlots = layoutCelestialLabels(candidates, viewer.scene.canvas.clientWidth, viewer.scene.canvas.clientHeight, labelSlots);
    for (const [id, offset] of labelSlots) { const label = placeholders.get(id).label; label.pixelOffset = new Cartesian2(...offset); label.show = true; }
  }
  function renderSymbols(time, force = false) {
    symbols.update(time);
    const now = performance.now();
    if (force || now - lastLayout > 100) { lastLayout = now; layoutLabels(); }
    for (const [id, item] of placeholders) item.label.show = Boolean(item.labelWanted) && (!viewer.scene.camera || labelSlots.has(id));
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
            updatePositions(true);
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
  function updatePositions(force = false, renderTime) {
    if (!alive()) return;
    sceneTime = renderTime || viewer.clock.currentTime;
    const transform = localBody && !travelling ? bodyLocalTransform(localBody, sceneTime, localView.basis) : null;
    if (transform) Matrix4.setTranslation(transform, positionOf(localBody), transform);
    const rotation = transform ? Matrix4.getMatrix3(transform, new Matrix3()) : null;
    for (const id of details.keys()) {
      const pos = positionOf(id);
      if (!pos) continue;
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
    for (const [center, group] of orbitGroups) group.modelMatrix = Matrix4.fromRotationTranslation(inertialToFixedMatrix(sceneTime), positionOf(center), group.modelMatrix);
    for (const item of orbits.values()) if (item.entity.show) item.sample(sceneTime);
    if (!viewer.scene.preRender) renderSymbols(sceneTime, force);
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
  // DataSourceDisplay updates custom sources before its default Entity
  // visualizers. Resolve the frame and representation flags here so models
  // and points change ownership in the same frame (preUpdate alone is later
  // than the entity visualizers and can leave a stale point for one frame).
  const dataSources = viewer.dataSources;
  const frameSource = dataSources ? new CustomDataSource("celestial-frame") : null;
  if (frameSource) {
    frameSource.update = (time) => { updatePositions(false, time); visualTime = JulianDate.clone(time, visualTime); return true; };
    dataSources.add(frameSource).then(() => { if (!alive() && !dataSources.isDestroyed()) dataSources.remove(frameSource, true); });
  }
  // Explicit scene renders can supply their own timestamp. Normal Viewer
  // renders already resolved it in the data-source pass, avoiding duplicate work.
  const offTick = viewer.scene.preUpdate ? viewer.scene.preUpdate.addEventListener((_scene, time) => {
    if (!visualTime || !JulianDate.equals(visualTime, time)) updatePositions(false, time);
  }) : viewer.clock.onTick.addEventListener(() => updatePositions());
  // After native controller/camera updates, before collection GPU uploads.
  const offRender = viewer.scene.preRender?.addEventListener((_scene, time) => {
    if (alive()) renderSymbols(time);
  });
  function setScale(value) {
    if (!alive() || travelling || !(options.isLive?.() ?? true) || !Number.isFinite(value)) return false;
    const range = scaleToRange(value, scaleMinimum());
    if (localView) localView.range = range;
    else {
      const center = positionOf(selectedId), offset = Cartesian3.subtract(viewer.camera.positionWC, center, new Cartesian3());
      Cartesian3.normalize(offset, offset);
      const destination = Cartesian3.add(center, Cartesian3.multiplyByScalar(offset, range, offset), offset);
      viewer.camera.setView({ destination, orientation: { direction: Cartesian3.clone(viewer.camera.directionWC), up: Cartesian3.clone(viewer.camera.upWC) } });
    }
    updatePositions(prefersReducedMotion());
    publishedScale = { visible: scaleVisible, value: rangeToScale(range, scaleMinimum()), range, stage: lod.stage };
    options.onScaleChange?.(publishedScale);
    viewer.scene.requestRender(); return true;
  }
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
    offRender?.();
    if (alive()) symbols.destroy();
    if (frameSource && !dataSources.isDestroyed()) dataSources.remove(frameSource, true);
    if (alive()) [controller.minimumZoomDistance, controller.maximumZoomDistance] = originalBounds;
    if (originalFar && alive()) viewer.camera.frustum.far = originalFar;
    options.setEarthRepresentation?.(true);
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
  return { focus, setSelected, updatePositions, setScale, canonicalPosition,
    selectMarker: (id) => { markerId = placeholders.has(id) ? id : null; updateLod(true); viewer.scene.requestRender(); },
    isWide: () => lod.solar > 0,
    isSystemScale: () => lod.local > 0,
    follow: (id) => { if (!travelling && id === selectedId) { bindLocal(id); return true; } return false; }, destroy };
}
