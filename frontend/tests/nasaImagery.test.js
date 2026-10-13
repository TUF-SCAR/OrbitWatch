import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createNasaImageryService, nasaImageryPlan, dateInGibsCoverage} from "../src/services/nasaImagery.js";
const metadata=JSON.parse(readFileSync(new URL('./fixtures/gibs-domain.json',import.meta.url)));
const now=new Date('2026-10-12T12:00:00Z');

test("real NASA advertised intervals preserve missing dates and fixed future reference",()=>{
  assert.ok(dateInGibsCoverage('2000-02-24',metadata.times));
  assert.ok(!dateInGibsCoverage('1999-01-01',metadata.times));
  assert.ok(!dateInGibsCoverage('2025-08-09',metadata.times));
  const actual=nasaImageryPlan(new Date('2024-06-01T23:01:00Z'),metadata,now);
  assert.equal(actual.observationDate,'2024-06-01');assert.equal(actual.kind,'historical');assert.match(actual.message,/not an exact hour/);
  assert.equal(nasaImageryPlan(new Date('2025-08-09'),metadata,now).kind,'reference');
  for(const date of ['2027-01-01','2030-06-12']) {
    const plan=nasaImageryPlan(new Date(date),metadata,now);assert.equal(plan.observationDate,null);assert.equal(plan.kind,'reference');
  }
  assert.equal(nasaImageryPlan(new Date('2024-01-01'),null,now).kind,'reference');
});

test("NASA service caches verified metadata, cancels stale transitions, and never substitutes an observation",async()=>{
  let loads=0, references=0;
  const service=createNasaImageryService({now:()=>now,fetchMetadata:async()=>{loads++;return metadata;},reference:()=>{references++;return {};},history:plan=>({day:plan.observationDate})});
  const controller=new AbortController();
  const a=await service.create(new Date('2024-01-01'),controller.signal);
  const b=await service.create(new Date('2024-01-02'),controller.signal);
  assert.equal(loads,1);assert.notEqual(a.provider.day,b.provider.day);
  const future=await service.create(new Date('2027-01-01'),controller.signal);
  assert.equal(future.details.observationDate,null);assert.equal(references,1);assert.equal(loads,1);
  controller.abort();await assert.rejects(service.create(new Date('2024-01-02'),controller.signal),/Cancelled/);
  const offline=createNasaImageryService({now:()=>now,fetchMetadata:async()=>{throw new Error('offline');},reference:()=>({})});
  const fallback=await offline.create(new Date('2024-01-01'),new AbortController().signal);
  assert.equal(fallback.details.kind,'reference');assert.equal(fallback.details.observationDate,null);
});
