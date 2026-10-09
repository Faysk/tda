import test from "node:test";
import assert from "node:assert/strict";
import { parseWebTag, latestWebTag, nextWebTag, isExactSha } from "./web-release.mjs";

test("Web release versioning starts both channels at 1.0.0", () => {
  assert.equal(nextWebTag([], "preview"), "Pre_1.0.0");
  assert.equal(nextWebTag([], "production"), "Prod_1.0.0");
});
test("Web release versioning increments per channel without confusing legacy tags", () => {
  const tags = [
    "Pre_1.0.0", "Prod_1.0.0", "Prod_1.0.9", "Pre_1.0.2",
    "companion-v0.3.28", "prod-d3f41c1db820", "Pre_fake", "Pre_1.0.01",
  ];
  assert.equal(latestWebTag(tags, "preview"), "Pre_1.0.2");
  assert.equal(latestWebTag(tags, "production"), "Prod_1.0.9");
  assert.equal(nextWebTag(tags, "preview"), "Pre_1.0.3");
  assert.equal(nextWebTag(tags, "production"), "Prod_1.0.10");
});
test("Web release tags only match their channel and strict numeric identifiers", () => {
  assert.equal(parseWebTag("Pre_1.0.0", "preview")?.join("."), "1.0.0");
  assert.equal(parseWebTag("Prod_1.0.0", "production")?.join("."), "1.0.0");
  for (const bad of [
    "prod-abcd1234", "Pre_1.0", "Prod_1.0.0-rc", "Pre_1.0.0-extra",
    "companion-v0.3.28", "Prod_99999999999999999999.0.0",
  ]) {
    assert.equal(parseWebTag(bad, "production"), null);
    assert.equal(parseWebTag(bad, "preview"), null);
  }
});
test("Web release SHA must be complete and immutable", () => {
  assert.equal(isExactSha("a".repeat(40)), true);
  assert.equal(isExactSha("a".repeat(12)), false);
  assert.equal(isExactSha("g".repeat(40)), false);
});
