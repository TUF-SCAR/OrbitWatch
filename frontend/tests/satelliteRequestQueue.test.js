import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers";
import { createSatelliteRequestQueue } from "../src/services/satelliteRequestQueue.js";

const flush = () => new Promise(resolve => setImmediate(resolve));
test("repeated dependency batches keep a global four-request cap and isolate per-ID cancellation", async () => {
  const queue = createSatelliteRequestQueue(4), finish = new Map(), started = [];
  const work = id => signal => new Promise(resolve => {
    started.push(id); finish.set(id,resolve);
    signal.addEventListener("abort",resolve,{once:true});
  });
  for (let id=0; id<44; id++) queue.enqueue(id,work(id));
  assert.equal(queue.enqueue(0,work(0)),false);
  await flush(); assert.equal(queue.active,4); assert.equal(started.length,4);
  queue.cancel(2); queue.cancel(43);
  await flush(); assert.equal(queue.active,4); assert.equal(started.length,5);
  for (let id=44; id<143; id++) queue.enqueue(id,work(id));
  assert.equal(queue.active,4,"new dependency batches cannot spawn another worker pool");
  while (queue.size) {
    for (const resolve of finish.values()) resolve(); finish.clear();
    await flush(); assert.ok(queue.active<=4);
  }
  assert.ok(!started.includes(43),"cancelled queued orbit never fetches");
  assert.equal(new Set(started).size,started.length);
  queue.destroy(); assert.equal(queue.enqueue(999,work(999)),false);
});

test("unload/reload and logout abort owned requests without deleting a newer ID revision", async () => {
  const queue = createSatelliteRequestQueue(1), signals = [];
  queue.enqueue(1,signal=>new Promise(resolve=>{signals.push(signal);signal.addEventListener("abort",resolve,{once:true});}));
  await flush(); queue.cancel(1);
  queue.enqueue(1,signal=>new Promise(resolve=>{signals.push(signal);signal.addEventListener("abort",resolve,{once:true});}));
  await flush(); assert.ok(queue.has(1)); assert.equal(signals.length,2);
  assert.ok(signals[0].aborted); assert.ok(!signals[1].aborted);
  queue.destroy(); await flush(); assert.ok(signals[1].aborted);
  assert.equal(queue.active,0); assert.equal(queue.size,0);
});
