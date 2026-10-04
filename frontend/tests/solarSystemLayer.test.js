import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as schedule, clearTimeout as cancel } from "node:timers";
import { Cartesian3, EntityCollection, Event, JulianDate, Matrix3, Matrix4, Model, ScreenSpaceEventHandler, ScreenSpaceEventType, Transforms } from "cesium";
import { bodyPositionInertial } from "../src/data/solarSystemEphemeris.js";
import { createSolarSystemLayer } from "../src/services/solarSystemLayer.js";

function harness(context) {
  const listeners = new Map(), actions = new Map(), timers = new Set();
  const target = {
    addEventListener(type, listener) { const set = listeners.get(type) || new Set(); set.add(listener); listeners.set(type, set); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    onwheel: null,
  };
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.document = target;
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
  context.mock.method(Model, "fromGltfAsync", async (options) => {
    if (failModel) throw new Error("Synthetic model failure");
    const model = { ...options, readyEvent: new Event(), errorEvent: new Event(), ready: false, destroyed: false,
      isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; },
    };
    models.push(model);
    return model;
  });
  const camera = {
    positionWC: new Cartesian3(0, 0, 30000000), directionWC: new Cartesian3(0, 0, -1), upWC: Cartesian3.clone(Cartesian3.UNIT_Y),
    right: Cartesian3.clone(Cartesian3.UNIT_X), up: Cartesian3.clone(Cartesian3.UNIT_Y), transform: Matrix4.clone(Matrix4.IDENTITY), offset: null,
    lookAtTransform(transform, offset) { this.transform = Matrix4.clone(transform); if (offset) this.offset = { ...offset }; },
    cancelFlight() {}, setView() {},
    flyToBoundingSphere(_sphere, options) { if (failFlight) throw new Error("Synthetic flight failure"); queueMicrotask(options.complete); },
  };
  const controller = { minimumZoomDistance: 10, maximumZoomDistance: 1e12, enableInputs: true };
  const viewer = { entities: new EntityCollection(), camera, clock: { currentTime: start, onTick: new Event(), shouldAnimate: false }, isDestroyed: () => false,
    scene: { canvas: target, screenSpaceCameraController: controller, requestRender() {},
      primitives: { add(model) { primitives.add(model); queueMicrotask(() => { model.ready = true; model.readyEvent.raiseEvent(); }); }, remove(model) { primitives.delete(model); model.destroy(); } },
    },
  };
  return { viewer, actions, primitives, models, listeners, timers, start, dispose, failModels: () => { failModel = true; }, failFlights: () => { failFlight = true; } };
}

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
    const initialModel = Matrix4.clone([...fixture.primitives].find((model) => model.url.endsWith(`/${focus}.glb`)).modelMatrix);
    // Sample a sub-second render time, without refreshing throttled positions.
    viewer.clock.currentTime = JulianDate.addSeconds(start, 0.5, new JulianDate());
    viewer.clock.onTick.raiseEvent();
    const inverse = Matrix4.inverseTransformation(viewer.camera.transform, new Matrix4());
    const siblingPosition = viewer.entities.getById(`celestial-${sibling}`).position.getValue(viewer.clock.currentTime);
    const actual = Matrix4.multiplyByPoint(inverse, siblingPosition, new Cartesian3());
    const initialRotation = Matrix4.getMatrix3(arrival, new Matrix3());
    const relative = Cartesian3.subtract(bodyPositionInertial(sibling, viewer.clock.currentTime), bodyPositionInertial(focus, viewer.clock.currentTime), new Cartesian3());
    const expected = Matrix3.multiplyByVector(Matrix3.fromRotationZ(0.7), relative, new Cartesian3());
    assert.ok(Cartesian3.distance(actual, expected) < 0.01, `${focus}: sibling evaluated at render time`);
    assert.ok(Matrix3.equalsEpsilon(initialRotation, Matrix3.IDENTITY, 1e-14), "arrival axes preserve flight framing");
    const model = [...fixture.primitives].find((item) => item.url.endsWith(`/${focus}.glb`));
    const modelLocal = Matrix4.multiply(inverse, model.modelMatrix, new Matrix4());
    const initialLocal = Matrix4.multiply(Matrix4.inverseTransformation(arrival, new Matrix4()), initialModel, new Matrix4());
    assert.ok(Matrix4.equalsEpsilon(modelLocal, initialLocal, 0.01), `${focus}: model/rings do not spin with Earth`);
    assert.ok(Matrix3.equalsEpsilon(Matrix4.getMatrix3(modelLocal, new Matrix3()), Matrix4.getMatrix3(initialLocal, new Matrix3()), 1e-12), `${focus}: surface orientation is inertial`);
    const orbit = viewer.entities.values.find((entity) => entity.polyline);
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
    assert.equal(viewer.entities.values.find((entity) => entity.polyline).show, false);
  }
  await layer.focus("earth");
  assert.equal(fixture.primitives.size, 0);
  assert.equal(viewer.scene.screenSpaceCameraController.enableInputs, true);
  assert.ok(Matrix4.equals(viewer.camera.transform, Matrix4.IDENTITY));
  assert.equal(viewer.entities.values.filter((entity) => entity.polyline).length, 0);
  layer.destroy();
  layer.destroy();
  assert.equal(viewer.entities.values.length, 0);
  assert.equal(viewer.clock.onTick.numberOfListeners, 0);
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
  assert.equal(fixture.viewer.entities.values.find((entity) => entity.polyline).show, true);
});
