import { ArcType, BoundingSphere, CallbackPositionProperty, Cartesian2, Cartesian3, Color, ConstantPositionProperty, DistanceDisplayCondition, HeadingPitchRange, JulianDate, LabelStyle, Matrix4, Model, ScreenSpaceEventHandler, ScreenSpaceEventType } from "cesium";
import { ALL_CELESTIAL_IDS, CELESTIAL_BODIES } from "../data/celestialBodies.js";
import { bodyPositionFixed, sampleBodyOrbitFixed } from "../data/solarSystemEphemeris.js";
import { createSolarSurface } from "./solarSurface.js";
import { prefersReducedMotion } from "../utils/motionPreferences.js";

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
  let orbit = null, travelling = false, localBody = null, finishFlight = null;
  let localView = null, drag = null;
  const controller = viewer.scene.screenSpaceCameraController;
  const originalBounds = [controller.minimumZoomDistance, controller.maximumZoomDistance];
  const alive = () => !destroyed && !viewer.isDestroyed();
  const delay = (ms) => new Promise((resolve) => { const timer = window.setTimeout(() => { timers.delete(timer); resolve(false); }, ms); timers.set(timer, resolve); });
  const positionOf = (id) => id === "earth" ? Cartesian3.ZERO : bodyPositionFixed(id, viewer.clock.currentTime, new Cartesian3());
  const framingScale = (id) => CELESTIAL_BODIES[id].rings ? Math.max(7, Math.max(...CELESTIAL_BODIES[id].rings) * 3) : 5.5;
  const matrixOf = (id) => Matrix4.fromTranslation(positionOf(id), new Matrix4());

  for (const id of ALL_CELESTIAL_IDS) {
    const body = CELESTIAL_BODIES[id];
    const radius = Math.max(100, body.radiusKm * 1000);
    const position = new ConstantPositionProperty(positionOf(id) || Cartesian3.ZERO);
    const entity = viewer.entities.add({ id: `celestial-${id}`, name: body.name, position, show: id !== "earth", properties: { celestialId: id },
      ellipsoid: { radii: new Cartesian3(radius, radius, radius), material: Color.fromCssColorString(body.color), stackPartitions: 8, slicePartitions: 12, distanceDisplayCondition: new DistanceDisplayCondition(0, radius * 60) },
      point: { pixelSize: body.type === "Star" ? 8 : 5, color: Color.fromCssColorString(body.color), distanceDisplayCondition: new DistanceDisplayCondition(radius * 60, Number.MAX_VALUE) },
      label: { show: false, text: body.name, font: "600 14px Inter, sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -20) },
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
      // Entity visualizers update before this layer's clock listener. At an
      // asteroid's scale even one frame of orbital motion displaces its label
      // or fallback sphere. Evaluate only the destination at the render time;
      // all other lightweight bodies keep their throttled constant positions.
      item.entity.position = active
        ? new CallbackPositionProperty((time, result) => key === "earth" ? Cartesian3.clone(Cartesian3.ZERO, result) : bodyPositionFixed(key, time, result), false)
        : item.position;
    }
    if (orbit && alive()) viewer.entities.remove(orbit);
    orbit = null;
    if (selectedId !== "earth" && selectedId !== "sun" && alive()) {
      const positions = sampleBodyOrbitFixed(selectedId, viewer.clock.currentTime, 96);
      // These are space coordinates. Geodesic subdivision treats them as an
      // Earth-surface path and can allocate enormous worker buffers at AU scale.
      if (positions.length) orbit = viewer.entities.add({ polyline: { positions, arcType: ArcType.NONE, width: 1, material: Color.fromCssColorString(CELESTIAL_BODIES[selectedId].color).withAlpha(0.24) } });
    }
  }
  function loadDetail(id, token) {
    if (id === "earth") return Promise.resolve(true);
    if (details.get(id)?.ready && details.get(id)?.show) return Promise.resolve(true);
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
  }
  function bindLocal(id) {
    if (id === "earth") return;
    localBody = id;
    const radius = placeholders.get(id).radius;
    localView = { heading: 0.28, pitch: -0.24, range: radius * framingScale(id), pan: new Cartesian3() };
    controller.enableInputs = false;
    controller.minimumZoomDistance = radius * 1.08;
    controller.maximumZoomDistance = radius * 90;
    controller.enableTranslate = true;
  }
  function updatePositions(force = false) {
    if (!alive()) return;
    const now = performance.now();
    const updateAll = force || now - lastUpdate > 1000;
    if (updateAll) {
      lastUpdate = now;
      if (orbit) orbit.polyline.positions = sampleBodyOrbitFixed(selectedId, viewer.clock.currentTime, 96);
    }
    for (const [id, item] of placeholders) {
      if (!updateAll && !details.has(id) && id !== localBody) continue;
      const pos = positionOf(id);
      if (!pos) continue;
      item.position.setValue(pos);
      const model = details.get(id);
      if (model && !model.isDestroyed()) model.modelMatrix = Matrix4.fromTranslation(pos, new Matrix4());
    }
    if (localBody && !travelling) {
      const target = Cartesian3.add(positionOf(localBody), localView.pan, new Cartesian3());
      viewer.camera.lookAtTransform(Matrix4.fromTranslation(target, new Matrix4()), new HeadingPitchRange(localView.heading, localView.pitch, localView.range));
    }
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
    if (drag === "orbit") { localView.heading -= dx * 0.004; localView.pitch = Math.max(-1.45, Math.min(1.45, localView.pitch - dy * 0.004)); }
    else {
      const right = Cartesian3.multiplyByScalar(viewer.camera.rightWC, -dx * localView.range / 1200, new Cartesian3());
      const up = Cartesian3.multiplyByScalar(viewer.camera.upWC, dy * localView.range / 1200, new Cartesian3());
      Cartesian3.add(localView.pan, Cartesian3.add(right, up, right), localView.pan);
      const length = Cartesian3.magnitude(localView.pan);
      if (length > radius * 2) Cartesian3.multiplyByScalar(localView.pan, radius * 2 / length, localView.pan);
    }
    viewer.scene.requestRender();
  }, ScreenSpaceEventType.MOUSE_MOVE);
  localHandler.setInputAction((delta) => {
    if (!localView || travelling) return;
    const radius = placeholders.get(localBody).radius;
    localView.range = Math.max(radius * 1.15, Math.min(radius * 90, localView.range * Math.exp(-delta * 0.0015)));
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
          for (const key of wanted) if (!details.get(key)?.show) { removeDetail(key); pending.delete(key); loadDetail(key, token); }
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
      for (const key of details.keys()) if (!restored.has(key) || !details.get(key)?.show) removeDetail(key);
      const earthVisible = previous.id === "earth" || CELESTIAL_BODIES[previous.id].parent === "earth";
      placeholders.get("earth").entity.show = !earthVisible;
      if (earthVisible) options.showEarthDetail?.(); else options.hideEarthDetail?.();
      viewer.camera.setView({ destination: previous.position, orientation: { direction: previous.direction, up: previous.up } });
      localBody = previous.localBody;
      localView = previous.localView;
      const degraded = [...restored].some((key) => key !== "earth" && !details.get(key)?.show);
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
      }
    }
  }
  function destroy() {
    if (destroyed) return;
    generation += 1;
    offTick();
    localHandler.destroy();
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("blur", endDrag);
    finishFlight?.();
    for (const [timer, resolve] of timers) { window.clearTimeout(timer); resolve(false); }
    timers.clear();
    for (const id of details.keys()) removeDetail(id);
    solarSurface?.destroy();
    if (orbit && alive()) viewer.entities.remove(orbit);
    for (const item of placeholders.values()) if (alive()) viewer.entities.remove(item.entity);
    destroyed = true;
    placeholders.clear(); pending.clear();
  }
  return { focus, setSelected, updatePositions, follow: (id) => { if (!travelling && id === selectedId) { bindLocal(id); return true; } return false; }, destroy };
}
