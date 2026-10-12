// Viewer-owned request queue. Dependency updates cannot multiply worker pools
// or cancel unrelated queued orbits. Hidden/unloaded IDs cancel individually.
export function createSatelliteRequestQueue(limit = 4) {
  const pending = new Map(), waiting = [];
  let running = 0, destroyed = false;
  function pump() {
    while (!destroyed && running < limit && waiting.length) {
      const job = waiting.shift();
      if (job.controller.signal.aborted) continue;
      running++;
      Promise.resolve().then(() => job.work(job.controller.signal)).catch(error => {
        if (!job.controller.signal.aborted) console.warn("OrbitWatch: orbit request failed", error);
      }).finally(() => {
        running--;
        if (pending.get(job.id) === job) pending.delete(job.id);
        pump();
      });
    }
  }
  return {
    has: id => pending.has(id),
    enqueue(id, work) {
      if (destroyed || pending.has(id)) return false;
      const job = { id, work, controller:new AbortController() };
      pending.set(id, job); waiting.push(job); pump(); return true;
    },
    cancel(id) { pending.get(id)?.controller.abort(); pending.delete(id); },
    destroy() { destroyed = true; for (const job of pending.values()) job.controller.abort(); pending.clear(); waiting.length = 0; },
    get size() { return pending.size; },
    get active() { return running; },
  };
}
