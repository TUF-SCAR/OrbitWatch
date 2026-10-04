import assert from "node:assert/strict";
import test from "node:test";
import { createPlaceSearch } from "../src/services/placeSearch.js";

function fixture(timeout = 10000) {
  const requests = [], credits = new Set();
  const geocoder = { geocode: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) };
  const service = createPlaceSearch(geocoder, {
    addStaticCredit: (credit) => credits.add(credit.html),
    removeStaticCredit: (credit) => credits.delete(credit.html),
  }, () => {}, timeout);
  return { requests, credits, service };
}
const result = (name) => ({ displayName: name, attributions: [{ html: `Credit ${name}`, collapsible: false }] });

test("geocoding replaces and deduplicates returned attribution, then releases it", async () => {
  const f = fixture();
  const first = f.service.search("first");
  await Promise.resolve();
  f.requests[0].resolve([result("first"), result("first")]);
  assert.equal((await first).length, 2);
  assert.deepEqual([...f.credits], ["Credit first"]);
  const second = f.service.search("second");
  await Promise.resolve();
  f.requests[1].resolve([result("second")]);
  await second;
  assert.deepEqual([...f.credits], ["Credit second"]);
  f.service.destroy();
  assert.equal(f.credits.size, 0);
});

test("closed and superseded searches cannot publish late results or credits", async () => {
  const f = fixture(), controller = new AbortController();
  const closed = f.service.search("closed", controller.signal);
  const closedCheck = assert.rejects(closed, { name: "AbortError" });
  await Promise.resolve();
  controller.abort();
  await closedCheck;
  const older = f.service.search("older");
  const olderCheck = assert.rejects(older, { name: "AbortError" });
  await Promise.resolve();
  const latest = f.service.search("latest");
  await Promise.resolve();
  await olderCheck;
  f.requests[2].resolve([result("latest")]);
  await latest;
  f.requests[0].resolve([result("closed")]);
  f.requests[1].resolve([result("older")]);
  await Promise.resolve();
  assert.deepEqual([...f.credits], ["Credit latest"]);
  f.service.destroy();
});

test("stalled and destroyed geocoders settle without restoring attribution", async () => {
  const f = fixture(5);
  await assert.rejects(f.service.search("stall"), /timed out/);
  f.requests[0].resolve([result("too late")]);
  await Promise.resolve();
  assert.equal(f.credits.size, 0);
  const pending = f.service.search("destroy");
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await Promise.resolve();
  f.service.destroy();
  await rejected;
  f.requests[1].reject(new Error("late network failure"));
  await Promise.resolve();
  await assert.rejects(f.service.search("after destroy"), { name: "AbortError" });
  assert.equal(f.credits.size, 0);
});
