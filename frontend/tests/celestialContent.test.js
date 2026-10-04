import assert from "node:assert/strict";
import test from "node:test";
import { ALL_CELESTIAL_IDS } from "../src/data/celestialBodies.js";
import { bodyFacts, bodyRepresentation } from "../src/data/celestialFacts.js";
import { CELESTIAL_NOTES, bodyScienceSource, bodyAdditionalSources } from "../src/data/celestialNotes.js";

test("every destination has a varied, sourced fact sequence and an honest surface description", () => {
  assert.deepEqual(Object.keys(CELESTIAL_NOTES).sort(), [...ALL_CELESTIAL_IDS].sort());
  for (const id of ALL_CELESTIAL_IDS) {
    const facts = bodyFacts(id);
    assert.ok(facts.length >= 21 && facts.length <= 32, `${id}: ${facts.length} facts`);
    assert.equal(new Set(facts).size, facts.length, `${id}: duplicate facts`);
    assert.ok(facts.every((fact) => typeof fact === "string" && fact.length > 10 && !/undefined|NaN/.test(fact)), id);
    assert.ok(bodyRepresentation(id).length > 40, id);
    for (const url of [bodyScienceSource(id), ...bodyAdditionalSources(id).map((source) => source.url)]) {
      const source = new URL(url);
      assert.equal(source.protocol, "https:");
      assert.ok(["science.nasa.gov", "www.nasa.gov", "www.eso.org"].includes(source.hostname), `${id}: ${url}`);
    }
  }
});
