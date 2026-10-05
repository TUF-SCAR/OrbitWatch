import { bodyPositionFixed } from "../src/data/solarSystemEphemeris.js";
import { Cartesian3, Clock, ClockStep, Cesium3DTileset, EncodedCartesian3, JulianDate, Matrix4, LabelCollection, Model, PointPrimitiveCollection, PrimitiveCollection, Scene } from "cesium";

// Development fixture only. Read public scene/primitive APIs; never retain a
// destroyed scene. Browser heap values are estimates, not GPU measurements.
export function instrumentScenes() {
  const records = new Map();
  const visualCollections = new Set();
  const collectionTypes = [PointPrimitiveCollection, LabelCollection];
  const originalAdds = collectionTypes.map((Type) => Type.prototype.add);
  collectionTypes.forEach((Type, index) => { Type.prototype.add = function (...args) { visualCollections.add(this); return originalAdds[index].apply(this, args); }; });
  let previewClears = 0;
  const clocks = new Set();
  const tick = Clock.prototype.tick;
  Clock.prototype.tick = function (...args) { clocks.add(this); return tick.apply(this, args); };
  const contexts = [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean);
  const originalClears = contexts.map((Context) => Context.prototype.clear);
  contexts.forEach((Context, index) => {
    Context.prototype.clear = function (...args) {
      if (this.canvas.closest(".solar-system-webgl, .verified-model-canvas")) previewClears += 1;
      return originalClears[index].apply(this, args);
    };
  });
  function sampleCelestial(sampleScene, sampleTime) {
      const bodies = new Map(); let invalid = 0, drift = 0, duplicate = 0, leaders = 0, markers = 0, labels = 0, gpuErrorPixels = 0;
      for (const [scene, record] of [[sampleScene, { sceneTime: sampleTime }]]) {
        if (!record.sceneTime) continue;
        const check = (entity, position, kind) => {
          const id = entity?.properties?.celestialId?.getValue(record.sceneTime);
          if (!id) return;
          const center = bodyPositionFixed(id, record.sceneTime);
          if (![position.x, position.y, position.z].every(Number.isFinite)) invalid++;
          drift = Math.max(drift, Cartesian3.distance(position, center));
          leaders += Number(Boolean(entity.polyline));
          const counts = bodies.get(id) || { model: 0, point: 0, label: 0 };
          counts[kind]++; bodies.set(id, counts);
        };
        const visit = (collection) => {
          for (let i = 0; i < collection.length; i++) {
            const primitive = collection.get(i);
            if (primitive.show === false) continue;
            if (primitive instanceof PrimitiveCollection) visit(primitive);
            if (primitive instanceof Model && primitive.show) check(primitive.id, Cartesian3.fromElements(primitive.modelMatrix[12], primitive.modelMatrix[13], primitive.modelMatrix[14]), "model");

          }
        };
        visit(scene.primitives);
        for (const collection of visualCollections) {
          if (collection.isDestroyed()) { visualCollections.delete(collection); continue; }
          if (collection.show === false) continue;
          for (let j = 0; j < collection.length; j++) {
            const item = collection.get(j);
            if (item.show) {
              const world = Matrix4.multiplyByPoint(collection.modelMatrix, item.position, new Cartesian3());
              check(item.id, world, collection instanceof LabelCollection ? "label" : "point");
              if (!item.id?.properties?.celestialId) continue;
              const eye = Matrix4.multiplyByPoint(Matrix4.inverseTransformation(collection.modelMatrix, new Matrix4()), scene.camera.positionWC, new Cartesian3());
              const encoded = (value, camera) => { const a = EncodedCartesian3.encode(value), b = EncodedCartesian3.encode(camera); return Math.fround(Math.fround(Math.fround(a.high)-Math.fround(b.high)) + Math.fround(Math.fround(a.low)-Math.fround(b.low))); };
              const gpu = new Cartesian3(encoded(item.position.x,eye.x),encoded(item.position.y,eye.y),encoded(item.position.z,eye.z));
              const relative = Cartesian3.subtract(world,scene.camera.positionWC,new Cartesian3());
              const depth = Cartesian3.dot(relative,scene.camera.directionWC), gpuDepth = Cartesian3.dot(gpu,scene.camera.directionWC);
              if (depth > 0 && gpuDepth > 0) {
                const focal = scene.canvas.clientHeight / (2*Math.tan(scene.camera.frustum.fovy/2));
                for (const axis of [scene.camera.rightWC,scene.camera.upWC]) gpuErrorPixels = Math.max(gpuErrorPixels,Math.abs(Cartesian3.dot(relative,axis)/depth-Cartesian3.dot(gpu,axis)/gpuDepth)*focal);
              }
            }
          }
        }
      }
      for (const counts of bodies.values()) { duplicate += Number(counts.model > 0 && counts.point > 0); markers += counts.point; labels += counts.label; }
      return JSON.stringify({ driftMeters: Number(drift.toFixed(6)), gpuErrorPixels: Number(gpuErrorPixels.toFixed(6)), earthPhysical: sampleScene.globe?.show ?? false, invalid, duplicate, leaders, markers, labels, bodies: Object.fromEntries(bodies) });
  }
  const render = Scene.prototype.render, destroy = Scene.prototype.destroy;
  Scene.prototype.render = function (...args) {
    const start = performance.now();
    let rendered = false;
    const offRendered = this.postRender.addEventListener(() => { rendered = true; });
    try { return render.apply(this, args); }
    finally {
      offRendered();
      // requestRenderMode can tick without drawing. Sampling its new time
      // against the last uploaded positions would report fictitious drift.
      if (rendered && !this.isDestroyed()) {
        const record = records.get(this) || { frames: 0, elapsed: 0 };
        record.frames += 1; record.elapsed += performance.now() - start;
        record.time = args[0] && JulianDate.toDate(args[0]).getTime();
        record.sceneTime = args[0] && JulianDate.clone(args[0]);
        record.celestial = sampleCelestial(this, record.sceneTime);
        records.set(this, record);
      }
    }
  };
  Scene.prototype.destroy = function (...args) { records.delete(this); return destroy.apply(this, args); };
  return {
    read() {
      const clears = previewClears; previewClears = 0;
      let models = 0, tileBytes = 0, frames = 0, elapsed = 0, clockAge = 0, range = 0, far = 0;
      for (const [scene, record] of records) {
        frames += record.frames; elapsed += record.elapsed;
        range = Math.hypot(scene.camera.position.x, scene.camera.position.y, scene.camera.position.z) / 149597870700;
        far = scene.camera.frustum.far / 149597870700;
        record.frames = 0; record.elapsed = 0;
        if (record.time) clockAge = Math.round((Date.now() - record.time) / 1000);
        for (let i = 0; i < scene.primitives.length; i += 1) {
          const primitive = scene.primitives.get(i);
          if (primitive instanceof Model) models += 1;
          if (primitive instanceof Cesium3DTileset) tileBytes += primitive.totalMemoryUsageInBytes;
        }
      }
      return `Scenes ${records.size} · canvases ${document.querySelectorAll("canvas").length} · scene models ${models} · tiles ${(tileBytes / 1048576).toFixed(0)} MiB · heap ${performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) : "n/a"} MiB · render ${frames ? (elapsed / frames).toFixed(1) : "—"} ms · preview clears ${clears} · clock age ${clockAge}s · range ${range.toFixed(5)} AU · far ${far.toFixed(5)} AU`;
    },
    celestialRead() {
      const record = [...records.values()].at(-1);
      return record?.celestial || JSON.stringify({ driftMeters:0, invalid:0, duplicate:0, leaders:0, markers:0, labels:0, bodies:{} });
    },
    advance(seconds) { for (const clock of clocks) { clock.shouldAnimate = false; clock.clockStep = ClockStep.TICK_DEPENDENT; clock.currentTime = JulianDate.addSeconds(clock.currentTime, seconds, new JulianDate()); } },
    resume() { for (const clock of clocks) { clock.clockStep = ClockStep.SYSTEM_CLOCK; clock.shouldAnimate = true; } },
    zoom(factor) {
      for (const scene of records.keys()) scene.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: Math.log(factor) / 0.0015, bubbles: true, cancelable: true }));
    },
    dispose() { collectionTypes.forEach((Type, index) => { Type.prototype.add = originalAdds[index]; }); visualCollections.clear(); Clock.prototype.tick = tick; clocks.clear(); Scene.prototype.render = render; Scene.prototype.destroy = destroy; contexts.forEach((Context, index) => { Context.prototype.clear = originalClears[index]; }); records.clear(); },
  };
}
