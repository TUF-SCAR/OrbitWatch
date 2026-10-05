import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as schedule, clearTimeout as cancel } from "node:timers";
import { Cartesian3, DataSourceCollection, EntityCollection, Event, JulianDate, LabelCollection, PointPrimitiveCollection, Material, Matrix3, Matrix4, Model, SceneTransforms, PolylineCollection, ScreenSpaceEventHandler, ScreenSpaceEventType, Transforms } from "cesium";
import { AU_METERS, bodyPositionFixed, bodyPositionInertial } from "../src/data/solarSystemEphemeris.js";
import { ALL_CELESTIAL_IDS } from "../src/data/celestialBodies.js";
import { MAX_SOLAR_RANGE, SOLAR_OVERVIEW_IDS, solarSystemScales, rangeToScale } from "../src/services/solarSystemLod.js";
import { createSolarSystemLayer, pickSolarSystemObject } from "../src/services/solarSystemLayer.js";

function harness(context) {
  const listeners = new Map(), actions = new Map(), timers = new Set();
  const target = {
    addEventListener(type, listener) { const set = listeners.get(type) || new Set(); set.add(listener); listeners.set(type, set); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    onwheel: null,
  };
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.document = { ...target, createElement: () => ({ style: {} }), body: { appendChild() {}, removeChild() {} }, defaultView: { getComputedStyle: () => ({ getPropertyValue: (name) => ({ 'font-family': 'Inter', 'font-size': '14px', 'font-style': 'normal', 'font-weight': '600', 'line-height': 'normal' })[name] }) } };
  globalThis.window = { ...target, matchMedia: () => ({ matches: true }),
    setTimeout(fn, ms) { const timer = schedule(() => { timers.delete(timer); fn(); }, ms <= 700 ? 0 : ms); timer.unref(); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); cancel(timer); },
  };
  const dispose = () => { globalThis.window = previousWindow; globalThis.document = previousDocument; for (const timer of timers) cancel(timer); };
  context.mock.method(ScreenSpaceEventHandler.prototype, "setInputAction", (action, type) => actions.set(type, action));
  const start = JulianDate.fromIso8601("2026-10-04T00:00:00Z");
  context.mock.method(Transforms, "computeIcrfToFixedMatrix", (time, result) => Matrix3.fromRotationZ(0.7 - JulianDate.secondsDifference(time, start) * 2 * Math.PI / 86164, result));
  const primitives = new Set(), models = [];
  let failModel = false, failFlight = false;
  context.mock.method(Material, "fromType", (_type, uniforms) => ({ uniforms: { ...uniforms }, destroy() {}, isDestroyed: () => false }));
  context.mock.method(Model, "fromGltfAsync", async (options) => {
    if (failModel) throw new Error("Synthetic model failure");
    const model = { ...options, readyEvent: new Event(), errorEvent: new Event(), ready: false, destroyed: false,
      isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; },
    };
    models.push(model);
    return model;
  });
  const camera = {
    frustum: { far: 1e10 },
    positionWC: new Cartesian3(0, 0, 30000000), directionWC: new Cartesian3(0, 0, -1), upWC: Cartesian3.clone(Cartesian3.UNIT_Y),
    right: Cartesian3.clone(Cartesian3.UNIT_X), up: Cartesian3.clone(Cartesian3.UNIT_Y), transform: Matrix4.clone(Matrix4.IDENTITY), offset: null,
    lookAtTransform(transform, offset) { this.transform = Matrix4.clone(transform); if (offset) { this.offset = { ...offset }; this.positionWC = Matrix4.multiplyByPoint(transform, new Cartesian3(offset.range * Math.cos(offset.pitch) * Math.sin(offset.heading), offset.range * Math.cos(offset.pitch) * Math.cos(offset.heading), -offset.range * Math.sin(offset.pitch)), new Cartesian3()); } },
    cancelFlight() {}, setView(options) { this.positionWC = Cartesian3.clone(options.destination); this.directionWC = Cartesian3.clone(options.orientation.direction); this.upWC = Cartesian3.clone(options.orientation.up); },
    flyToBoundingSphere(sphere, options) { if (failFlight) throw new Error("Synthetic flight failure"); this.positionWC = Cartesian3.add(sphere.center, new Cartesian3(0, 0, options.offset.range), new Cartesian3()); queueMicrotask(options.complete); },
  };
  const controller = { minimumZoomDistance: 10, maximumZoomDistance: 1e12, enableInputs: true };
  const viewer = { dataSources: new DataSourceCollection(), entities: new EntityCollection(), camera, clock: { currentTime: start, onTick: new Event(), shouldAnimate: false }, isDestroyed: () => false,
    scene: { preUpdate: new Event(), canvas: target, screenSpaceCameraController: controller, requestRender() {},
      primitives: { add(model) { primitives.add(model); if (model.readyEvent) queueMicrotask(() => { model.ready = true; model.readyEvent.raiseEvent(); }); return model; }, remove(model) { primitives.delete(model); model.destroy(); } },
    },
  };
  const symbol = (id, Type = PointPrimitiveCollection) => { const collection = [...primitives].find(item => item instanceof Type); return Array.from({ length: collection.length }, (_, i) => collection.get(i)).find(item => item.id.id === `celestial-${id}`); };
  return { viewer, actions, primitives, models, listeners, timers, start, dispose, symbol, failModels: () => { failModel = true; }, failFlights: () => { failFlight = true; } };
}

test("wide marker picking prioritizes a planet under an orbit line while Earth keeps its native pick", () => {
  const line = { id: { polyline: {} } }, planet = { id: { properties: { celestialId: "jupiter" } } };
  const satellite = { id: { properties: { noradId: 25544 } } }, position = { x: 100, y: 100 };
  let native = 0, drill = 0;
  const scene = { pick(at) { assert.equal(at, position); native++; return satellite; },
    drillPick(at, limit) { assert.equal(at, position); assert.equal(limit, 12); drill++; return [line, planet]; } };
  assert.equal(pickSolarSystemObject(scene, position, false), satellite);
  assert.equal(pickSolarSystemObject(scene, position, true), planet);
  assert.equal(native, 1);
  assert.equal(drill, 1);
  scene.drillPick = () => [];
  assert.equal(pickSolarSystemObject(scene, position, true), undefined);
});

test("local layer synchronizes family positions, controls, models and orbit visibility; Earth and cleanup survive", async (context) => {
  const fixture = harness(context);
  const { viewer, actions, start } = fixture;
  const layer = createSolarSystemLayer(viewer);
  context.after(() => { layer.destroy(); fixture.dispose(); });
  layer.setSelected("earth");
  actions.get(ScreenSpaceEventType.LEFT_DOWN)();
  actions.get(ScreenSpaceEventType.MOUSE_MOVE)({ startPosition: { x: 0, y: 0 }, endPosition: { x: 50, y: 20 } });
  assert.equal(viewer.camera.offset, null, "Earth gestures remain owned by Cesium");
  for (const [focus, sibling] of [["mars", "deimos"], ["phobos", "deimos"], ["jupiter", "callisto"], ["europa", "io"], ["saturn", "iapetus"], ["titan", "rhea"]]) {
    viewer.clock.currentTime = start;
    assert.equal((await layer.focus(focus)).degraded, false);
    const arrival = Matrix4.clone(viewer.camera.transform);
    const initialModel = Matrix4.clone([...fixture.primitives].find((model) => model.url?.endsWith(`/${focus}.glb`)).modelMatrix);
    // Sample a sub-second render time, without refreshing throttled positions.
    viewer.clock.currentTime = JulianDate.addSeconds(start, 0.5, new JulianDate());
    viewer.scene.preUpdate.raiseEvent(viewer.scene, viewer.clock.currentTime);
    const inverse = Matrix4.inverseTransformation(viewer.camera.transform, new Matrix4());
    const siblingPosition = viewer.entities.getById(`celestial-${sibling}`).position.getValue(viewer.clock.currentTime);
    const actual = Matrix4.multiplyByPoint(inverse, siblingPosition, new Cartesian3());
    const initialRotation = Matrix4.getMatrix3(arrival, new Matrix3());
    const relative = Cartesian3.subtract(bodyPositionInertial(sibling, viewer.clock.currentTime), bodyPositionInertial(focus, viewer.clock.currentTime), new Cartesian3());
    const expected = Matrix3.multiplyByVector(Matrix3.fromRotationZ(0.7), relative, new Cartesian3());
    assert.ok(Cartesian3.distance(actual, expected) < 0.01, `${focus}: sibling evaluated at render time`);
    assert.ok(Matrix3.equalsEpsilon(initialRotation, Matrix3.IDENTITY, 1e-14), "arrival axes preserve flight framing");
    const model = [...fixture.primitives].find((item) => item.url?.endsWith(`/${focus}.glb`));
    const modelLocal = Matrix4.multiply(inverse, model.modelMatrix, new Matrix4());
    const initialLocal = Matrix4.multiply(Matrix4.inverseTransformation(arrival, new Matrix4()), initialModel, new Matrix4());
    assert.ok(Matrix4.equalsEpsilon(modelLocal, initialLocal, 0.01), `${focus}: model/rings do not spin with Earth`);
    assert.ok(Matrix3.equalsEpsilon(Matrix4.getMatrix3(modelLocal, new Matrix3()), Matrix4.getMatrix3(initialLocal, new Matrix3()), 1e-12), `${focus}: surface orientation is inertial`);
    const orbit = viewer.entities.getById(`celestial-orbit-${focus}`);
    assert.equal(orbit.show, ["phobos", "europa", "titan"].includes(focus));
    assert.equal(orbit.polyline.positions.getValue(viewer.clock.currentTime).length, 97, "hidden solar orbit data retained");
    actions.get(ScreenSpaceEventType.LEFT_DOWN)();
    const before = { ...viewer.camera.offset };
    actions.get(ScreenSpaceEventType.MOUSE_MOVE)({ startPosition: { x: 0, y: 0 }, endPosition: { x: 50, y: 20 } });
    layer.updatePositions();
    assert.ok(Math.abs(viewer.camera.offset.heading - before.heading - 0.2) < 1e-12, "right drag increases heading");
    assert.ok(Math.abs(viewer.camera.offset.pitch - before.pitch + 0.08) < 1e-12, "vertical response unchanged");
    actions.get(ScreenSpaceEventType.LEFT_UP)();
    actions.get(ScreenSpaceEventType.WHEEL)(120);
    layer.updatePositions();
    assert.ok(Math.abs(viewer.camera.offset.range / before.range - Math.exp(-0.18)) < 1e-12, "wheel response unchanged");
    actions.get(ScreenSpaceEventType.RIGHT_DOWN)();
    const range = viewer.camera.offset.range;
    actions.get(ScreenSpaceEventType.MOUSE_MOVE)({ startPosition: { x: 0, y: 0 }, endPosition: { x: 12, y: 6 } });
    layer.updatePositions();
    const selectedLocal = Matrix4.multiplyByPoint(Matrix4.inverseTransformation(viewer.camera.transform, new Matrix4()), viewer.entities.getById(`celestial-${focus}`).position.getValue(viewer.clock.currentTime), new Cartesian3());
    assert.ok(Cartesian3.distance(selectedLocal, new Cartesian3(range * 0.01, -range * 0.005, 0)) < 0.01, "pan stays in camera reference coordinates");
    actions.get(ScreenSpaceEventType.RIGHT_UP)();
  }
  for (const focus of ["eris", "bennu"]) {
    await layer.focus(focus);
    assert.equal(viewer.entities.getById(`celestial-orbit-${focus}`).show, false);
  }
  await layer.focus("earth");
  assert.equal([...fixture.primitives].filter((item) => item.url).length, 0);
  assert.equal(viewer.scene.screenSpaceCameraController.enableInputs, true);
  assert.ok(Matrix4.equals(viewer.camera.transform, Matrix4.IDENTITY));
  assert.ok(viewer.entities.values.filter((entity) => entity.polyline).every((entity) => !entity.show || !entity.polyline.show.getValue()), "all solar/local paths hidden at close Earth");
  layer.destroy();
  layer.destroy();
  assert.equal(fixture.primitives.size, 0, "all orbit collections and models released");
  assert.equal(viewer.entities.values.length, 0);
  assert.equal(viewer.clock.onTick.numberOfListeners, 0);
  assert.equal(viewer.scene.preUpdate.numberOfListeners, 0);
  assert.equal(viewer.dataSources.length, 0);
  assert.equal(fixture.timers.size, 0);
  assert.equal([...fixture.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
  assert.ok(fixture.models.every((model) => model.isDestroyed()));
});

test("failed models retain usable local fallback and failed travel restores its frame", async (context) => {
  const fixture = harness(context);
  fixture.failModels();
  const layer = createSolarSystemLayer(fixture.viewer);
  context.after(() => { layer.destroy(); fixture.dispose(); });
  assert.equal((await layer.focus("phobos")).degraded, true);
  const before = Matrix4.clone(fixture.viewer.camera.transform);
  fixture.failFlights();
  context.mock.method(console, "warn", () => {});
  assert.equal((await layer.focus("earth")).error, true);
  assert.ok(Matrix4.equalsEpsilon(fixture.viewer.camera.transform, before, 0.001));
  assert.equal(fixture.viewer.entities.getById("celestial-deimos").position.isConstant, false);
  assert.equal(fixture.viewer.entities.getById("celestial-phobos").ellipsoid.show.getValue(), true);
  assert.equal(fixture.viewer.entities.getById("celestial-orbit-phobos").show, true);
});

test("continuous zoom reuses bounded solar paths and markers without loading distant models", async (context) => {
  const fixture = harness(context);
  const { viewer, actions, start } = fixture;
  let live = true;
  const layer = createSolarSystemLayer(viewer, { isLive: () => live });
  context.after(() => { layer.destroy(); fixture.dispose(); });
  const orbit = (id) => viewer.entities.getById(`celestial-orbit-${id}`);
  const zoom = (range) => { actions.get(ScreenSpaceEventType.WHEEL)(-Math.log(range / viewer.camera.offset.range) / 0.0015); layer.updatePositions(true); };
  for (const focus of ["mars", "jupiter", "moon", "europa"]) {
    await layer.focus(focus);
    const scales = solarSystemScales(focus), initialModels = fixture.models.length;
    const modelSet = [...fixture.primitives].filter((item) => item.url);
    assert.equal(orbit(scales.parent)?.show ?? false, false, `${focus}: no close heliocentric line`);
    zoom(scales.localEnd);
    const moon = scales.family.find((id) => id !== focus && ["phobos", "deimos", "moon", "io", "europa", "ganymede", "callisto"].includes(id));
    if (moon) assert.equal(orbit(moon).show, true, `${focus}: local moon paths`);
    zoom(scales.solarEnd);
    assert.equal(orbit(scales.parent).show, true);
    zoom(100 * AU_METERS);
    assert.equal(layer.isWide(), true);
    assert.ok(viewer.camera.frustum.far > 100 * AU_METERS, "AU context remains inside extended frustum");
    for (const id of SOLAR_OVERVIEW_IDS) {
      const entity = viewer.entities.getById(`celestial-${id}`);
      assert.equal(entity.show, true, id);
      assert.equal(fixture.symbol(id).show, true, id);
      assert.equal(fixture.symbol(id, LabelCollection).show, true, id);
      assert.ok(Cartesian3.distance(entity.position.getValue(viewer.clock.currentTime), bodyPositionFixed(id, viewer.clock.currentTime)) < 0.001);
      if (id !== "sun") {
        assert.equal(orbit(id).show, true, id);
        assert.equal(orbit(id).polyline.positions.getValue(viewer.clock.currentTime).length, 97);
      }
    }
    assert.equal(viewer.entities.getById("celestial-ceres").show, false);
    assert.equal(fixture.models.length, initialModels, "overview/selection never loads more GLBs");
    const entities = [...viewer.entities.values];
    layer.selectMarker("saturn");
    assert.equal(fixture.symbol("saturn").outlineWidth, 2);
    assert.equal(fixture.models.length, initialModels, "selecting a marker does not travel");
    assert.deepEqual([...fixture.primitives].filter((item) => item.url), modelSet);
    const points = orbit("mars").polyline.positions.getValue(start);
    const groups = [...fixture.primitives].filter((item) => item instanceof PolylineCollection);
    assert.ok(groups.length <= 2, "only solar and current parent system own path buffers");
    const buffers = groups.flatMap((group) => Array.from({ length: group.length }, (_, i) => group.get(i).positions));
    for (let i = 0; i < 3; i++) {
      zoom(scales.radius * 5.5);
      assert.equal(layer.isWide(), false);
      assert.equal(orbit(scales.parent).show, false);
      zoom(100 * AU_METERS);
      assert.equal(orbit("mars").polyline.positions.getValue(start), points, "camera zoom keeps sampled geometry/arrays");
    }
    groups.flatMap((group) => Array.from({ length: group.length }, (_, i) => group.get(i).positions)).forEach((buffer, index) => assert.equal(buffer, buffers[index], "zoom never replaces GPU path vertices"));
    assert.deepEqual(viewer.entities.values, entities, "camera movements reuse entities");
    // Solar paths remain stable in the local inertial frame between samples.
    zoom(scales.solarEnd);
    const sample = orbit(scales.parent).polyline.positions.getValue(start)[12];
    const before = Cartesian3.subtract(sample, bodyPositionFixed("sun", start), new Cartesian3());
    const later = JulianDate.addSeconds(start, 0.5, new JulianDate());
    const after = Cartesian3.subtract(orbit(scales.parent).polyline.positions.getValue(later)[12], bodyPositionFixed("sun", later), new Cartesian3());
    const expected = Matrix3.multiplyByVector(Matrix3.fromRotationZ(-0.5 * 2 * Math.PI / 86164), before, new Cartesian3());
    assert.ok(Cartesian3.distance(after, expected) < 0.01, "same-time path transform cancels Earth's rotation");
    viewer.clock.currentTime = later;
    layer.updatePositions();
    for (const group of groups) for (let i = 0; i < group.length; i++) {
      const line = group.get(i);
      if (!line.show) continue;
      const world = Matrix4.multiplyByPoint(group.modelMatrix, line.positions[12], new Cartesian3());
      const data = line.id.polyline.positions.getValue(later)[12];
      assert.ok(Cartesian3.distance(world, data) < 0.01, "GPU parent/inertial transform agrees with same-time world data");
    }
    viewer.clock.currentTime = start;
  }
  await layer.focus("earth");
  assert.equal([...fixture.primitives].filter((item) => item.url).length, 0);
  assert.equal(viewer.scene.screenSpaceCameraController.enableInputs, true);
  viewer.camera.positionWC = new Cartesian3(0, 0, 30e6);
  layer.updatePositions(true);
  assert.equal(orbit("earth").show, false);
  assert.equal(viewer.camera.frustum.far, 1e10, "native close Earth frustum is restored");
  viewer.camera.positionWC = new Cartesian3(0, 0, 100 * AU_METERS);
  layer.updatePositions(true);
  assert.equal(orbit("earth").show, true, "native Earth camera reaches same context");
  live = false;
  layer.updatePositions(true);
  assert.ok(viewer.entities.values.every((entity) => !entity.show), "context belongs only to Live Mode");
  layer.destroy();
  assert.equal(fixture.primitives.size, 0, "all orbit collections and models released");
  assert.equal(viewer.entities.values.length, 0);
  assert.equal(viewer.clock.onTick.numberOfListeners, 0);
  assert.equal(viewer.scene.preUpdate.numberOfListeners, 0);
  assert.equal(viewer.dataSources.length, 0);
  assert.equal(viewer.camera.frustum.far, 1e10, "cleanup restores original frustum");
});

test("all 47 destinations share canonical render-time centers and exclusive representations through hours and zoom", async (context) => {
  const fixture = harness(context), { viewer, start, models } = fixture;
  const states = [];
  const layer = createSolarSystemLayer(viewer, { onScaleChange: (state) => states.push(state) });
  context.after(() => { layer.destroy(); fixture.dispose(); });
  for (const id of ALL_CELESTIAL_IDS) {
    viewer.clock.currentTime = start;
    await layer.focus(id);
    const entity = viewer.entities.getById(`celestial-${id}`), property = entity.position;
    const model = models.findLast((model) => model.url.endsWith(`/${id}.glb`) && !model.destroyed);
    const scales = solarSystemScales(id);
    for (const seconds of [0, 0.016, 600, 21600, 172800]) {
      const time = JulianDate.addSeconds(start, seconds, new JulianDate());
      // Deliberately leave clock.currentTime stale: render time is authoritative.
      viewer.scene.preUpdate.raiseEvent(viewer.scene, time);
      const center = entity.position.getValue(time);
      assert.ok(Cartesian3.equalsEpsilon(center, bodyPositionFixed(id, time), 1e-14, 0.00001), `${id}: canonical center at ${seconds}s`);
      assert.equal(entity.position, property, `${id}: reused position property`);
      assert.equal(entity.polyline, undefined, `${id}: no annotation connectors`);
      if (model) assert.ok(Cartesian3.distance(Matrix4.getTranslation(model.modelMatrix, new Cartesian3()), center) < 0.00001, `${id}: model vs marker at ${seconds}s`);
      for (const relativeId of scales.family) {
        const relative = viewer.entities.getById(`celestial-${relativeId}`).position.getValue(time);
        assert.ok(Cartesian3.equalsEpsilon(relative, layer.canonicalPosition(relativeId, time), 1e-14, 0.00001), `${id}/${relativeId}`);
      }
    }
    viewer.clock.currentTime = start;
    for (const range of [scales.radius * 5.5, scales.radius * 24, scales.radius * 33, scales.radius * 50, scales.localEnd, scales.solarEnd, MAX_SOLAR_RANGE, scales.radius * 24]) {
      if (id === "earth") viewer.camera.positionWC = new Cartesian3(0, 0, range);
      else layer.setScale(rangeToScale(range, scales.localStart));
      layer.updatePositions(true);
      const physicalCount = Number(Boolean(model?.show)) + Number(entity.show && entity.ellipsoid.show.getValue());
      const symbolicCount = Number(entity.show && fixture.symbol(id).show);
      assert.ok(physicalCount <= 1, `${id}: model/fallback mutually exclusive`);
      assert.ok(physicalCount + symbolicCount <= 1, `${id}: no marker through physical body`);
      assert.ok(fixture.symbol(id).pixelSize <= 9, id);
      assert.ok([...fixture.primitives].filter((item) => item.url).length <= 2, id);
    }
    assert.ok(states.at(-1).value >= 0 && states.at(-1).value <= 1, id);
  }
  layer.destroy();
  assert.equal(fixture.primitives.size, 0);
  assert.equal(viewer.scene.preUpdate.numberOfListeners, 0);
  assert.equal(viewer.dataSources.length, 0);
  assert.equal(viewer.entities.values.length, 0);
});

test("slider changes only range, wheel and slider share scale, Earth orientation is preserved", async (context) => {
  const fixture = harness(context), { viewer, actions } = fixture;
  let state;
  const layer = createSolarSystemLayer(viewer, { onScaleChange: (next) => { state = next; } });
  context.after(() => { layer.destroy(); fixture.dispose(); });
  await layer.focus("kerberos");
  const offset = { ...viewer.camera.offset }, transform = Matrix4.clone(viewer.camera.transform);
  layer.setScale(0.6);
  assert.equal(viewer.camera.offset.heading, offset.heading);
  assert.equal(viewer.camera.offset.pitch, offset.pitch);
  assert.ok(Matrix4.equalsEpsilon(viewer.camera.transform, transform, 0.00001));
  assert.ok(Math.abs(state.value - 0.6) < 1e-12);
  actions.get(ScreenSpaceEventType.WHEEL)(-120);
  layer.updatePositions(true);
  assert.ok(state.value > 0.6);
  await layer.focus("earth");
  const direction = Cartesian3.clone(viewer.camera.directionWC), up = Cartesian3.clone(viewer.camera.upWC);
  assert.equal(layer.isSystemScale(), false, "ordinary Earth remains eligible for idle framing");
  layer.setScale(0.9);
  assert.equal(layer.isSystemScale(), true, "wider Earth excludes idle framing before heliocentric context");
  assert.ok(Cartesian3.equals(viewer.camera.directionWC, direction));
  assert.ok(Cartesian3.equals(viewer.camera.upWC, up));
  assert.ok(Math.abs(state.value - 0.9) < 1e-12);
  assert.equal(viewer.scene.screenSpaceCameraController.maximumZoomDistance, MAX_SOLAR_RANGE, "native wheel shares the slider ceiling");
  for (const range of [7e6, 15e6, 30e6, 40e6, 50e6]) {
    viewer.camera.positionWC = new Cartesian3(0, 0, range); layer.updatePositions(true);
    assert.equal(layer.isSystemScale(), false, `idle eligibility returns at ordinary Earth range ${range}`);
    assert.ok(viewer.entities.values.filter((entity) => entity.id.startsWith("celestial-")).every((entity) => !entity.show), `no Earth leakage at ${range}`);
    assert.equal(viewer.scene.screenSpaceCameraController.maximumZoomDistance, 1e12, "ordinary Earth bounds restored");
  }
  layer.setScale(1);
  layer.destroy();
  assert.equal(viewer.scene.screenSpaceCameraController.maximumZoomDistance, 1e12, "destroy restores native bounds");
});

test("all destinations keep fallback and point ownership exclusive when GLBs fail", async (context) => {
  const fixture = harness(context), { viewer } = fixture;
  fixture.failModels();
  const layer = createSolarSystemLayer(viewer);
  context.after(() => { layer.destroy(); fixture.dispose(); });
  for (const id of ALL_CELESTIAL_IDS) {
    const result = await layer.focus(id);
    assert.equal(result.degraded, id !== "earth", id);
    const entity = viewer.entities.getById(`celestial-${id}`), scales = solarSystemScales(id);
    if (id !== "earth") {
      assert.equal(entity.ellipsoid.show.getValue(), true, `${id}: close fallback`);
      assert.equal(fixture.symbol(id).show, false, id);
      layer.setScale(rangeToScale(scales.radius * 60, scales.localStart));
      assert.equal(entity.ellipsoid.show.getValue(), false, `${id}: no duplicate sphere`);
      assert.equal(fixture.symbol(id).show, true, id);
    }
  }
});

test("frame source resolves ownership before Entity visualization, with exact same-time scene models", async (context) => {
  const fixture = harness(context), { viewer, actions, start } = fixture;
  const layer = createSolarSystemLayer(viewer);
  context.after(() => { layer.destroy(); fixture.dispose(); });
  for (const id of ALL_CELESTIAL_IDS.filter(id => id !== "earth")) {
    await layer.focus(id);
    const source = viewer.dataSources.get(0);
    assert.equal(source.entities.values.length, 0, "frame source adds no representation entities");
    const model = [...fixture.primitives].find(model => model.url?.endsWith(`/${id}.glb`)), entity = viewer.entities.getById(`celestial-${id}`);
    for (const delta of [-1800, 1800, -1800, 1800]) {
      actions.get(ScreenSpaceEventType.WHEEL)(delta);
      // This is Cesium's source -> default visualizers -> preUpdate order.
      const time = JulianDate.addSeconds(start, 0.5, new JulianDate());
      source.update(time);
      const pointShown = entity.show && fixture.symbol(id).show;
      const renderedCenter = entity.position.getValue(time);
      viewer.scene.preUpdate.raiseEvent(viewer.scene, time);
      assert.ok(!(pointShown && model.show), `${id}: never double-drawn in a handoff frame`);
      assert.ok(Cartesian3.distance(renderedCenter, Matrix4.getTranslation(model.modelMatrix,new Cartesian3())) < 0.00001, id);
      // Force LOD evaluation for this deterministic zero-wall-time harness.
      layer.updatePositions(true);
    }
  }
});


test("Earth stays represented through every imaged-to-symbolic handoff range", async (context) => {
  const fixture = harness(context), { viewer } = fixture;
  let globe = true;
  const layer = createSolarSystemLayer(viewer, { setEarthRepresentation: show => { globe = show; } });
  context.after(() => { layer.destroy(); fixture.dispose(); });
  await layer.focus("earth");
  const radius = solarSystemScales("earth").radius;
  for (const distances of [Array.from({length:250}, (_,i) => (i+1)*radius), Array.from({length:250}, (_,i) => (250-i)*radius)]) {
    for (const distance of distances) {
      viewer.camera.positionWC = new Cartesian3(0, 0, distance); layer.updatePositions(true);
      const point = fixture.symbol("earth");
      assert.ok(globe || point.show && point.color.alpha === 1, `Earth never absent at ${distance/radius} radii`);
      assert.ok(!(globe && point.show), "opaque globe hides symbolic center until disc-sized handoff");
    }
  }
});

test("symbol collections rebase all 47 same-time centers after the final camera update and clean up", async (context) => {
  const fixture = harness(context), { viewer, start } = fixture;
  viewer.scene.camera = viewer.camera;
  viewer.scene.preRender = new Event();
  context.mock.method(SceneTransforms, "worldToWindowCoordinates", () => ({x:400,y:300}));
  const layer = createSolarSystemLayer(viewer);
  context.after(() => { layer.destroy(); fixture.dispose(); });
  for (const id of ALL_CELESTIAL_IDS) {
    await layer.focus(id);
    for (const seconds of [0,0.016,21600,172800]) {
      const time = JulianDate.addSeconds(start, seconds, new JulianDate());
      viewer.clock.currentTime = time; layer.updatePositions(true);
      // Native camera changes after data-source/preUpdate evaluation.
      viewer.camera.positionWC = Cartesian3.add(viewer.camera.positionWC, new Cartesian3(1234,5678,-900), new Cartesian3());
      viewer.scene.preRender.raiseEvent(viewer.scene, time);
      const points = [...fixture.primitives].find(item => item instanceof PointPrimitiveCollection);
      const labels = [...fixture.primitives].find(item => item instanceof LabelCollection);
      for (const body of ALL_CELESTIAL_IDS) {
        const point = fixture.symbol(body), label = fixture.symbol(body, LabelCollection);
        assert.deepEqual(point.position, label.position);
        assert.ok(Cartesian3.distance(Matrix4.multiplyByPoint(points.modelMatrix, point.position, new Cartesian3()), bodyPositionFixed(body,time)) < 0.005, body);
        assert.ok(Matrix4.equals(points.modelMatrix, labels.modelMatrix));
        assert.equal(point.id, viewer.entities.getById(`celestial-${body}`), "picking retains Entity identity");
      }
    }
  }
  layer.destroy();
  assert.equal(viewer.scene.preRender.numberOfListeners,0);
  assert.equal(fixture.primitives.size,0);
});
