import { Cesium3DTileset, JulianDate, Model, Scene } from "cesium";

// Development fixture only. Read public scene/primitive APIs; never retain a
// destroyed scene. Browser heap values are estimates, not GPU measurements.
export function instrumentScenes() {
  const records = new Map();
  let previewClears = 0;
  const contexts = [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean);
  const originalClears = contexts.map((Context) => Context.prototype.clear);
  contexts.forEach((Context, index) => {
    Context.prototype.clear = function (...args) {
      if (this.canvas.closest(".solar-system-webgl, .verified-model-canvas")) previewClears += 1;
      return originalClears[index].apply(this, args);
    };
  });
  const render = Scene.prototype.render, destroy = Scene.prototype.destroy;
  Scene.prototype.render = function (...args) {
    const start = performance.now();
    try { return render.apply(this, args); }
    finally {
      if (!this.isDestroyed()) {
        const record = records.get(this) || { frames: 0, elapsed: 0 };
        record.frames += 1; record.elapsed += performance.now() - start;
        record.time = args[0] && JulianDate.toDate(args[0]).getTime();
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
    zoom(factor) {
      for (const scene of records.keys()) scene.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: Math.log(factor) / 0.0015, bubbles: true, cancelable: true }));
    },
    dispose() { Scene.prototype.render = render; Scene.prototype.destroy = destroy; contexts.forEach((Context, index) => { Context.prototype.clear = originalClears[index]; }); records.clear(); },
  };
}
