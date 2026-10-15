import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditWikiCoverage } from "./coverage.mjs";

test("coverage counts linked/unlinked docs and reports missing declared metadata", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-coverage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "docs", "features"), { recursive: true });
  fs.mkdirSync(path.join(root, "wiki"));
  fs.writeFileSync(path.join(root, "docs", "README.md"), "# Docs\n> Owner: team\n> Última revisão: 2026-10-15\n");
  fs.writeFileSync(path.join(root, "docs", "features", "one.md"), "# One");
  fs.writeFileSync(path.join(root, "docs", "features", "two.md"), "# Two");
  fs.writeFileSync(path.join(root, "wiki", "Home.md"), "[Ref](https://github.com/Faysk/tda/blob/main/docs/features/one.md)");
  const r = auditWikiCoverage(root);
  assert.equal(r.docs, 3);
  assert.equal(r.linked, 1);
  assert.equal(r.notLinked, 2);
  assert.equal(r.missingOwner, 2);
  assert.equal(r.missingReview, 2);
  assert.equal(r.byArea.features.linked, 1);
  assert.deepEqual(r.unresolved, []);
  assert.deepEqual(r.sourceMatrix.find(x => x.path === "docs/features/one.md").wikiPages, ["Home"]);
  assert.equal(r.sourceMatrix.find(x => x.path === "docs/README.md").owner, "team");
  assert.equal(r.sourceMatrix.find(x => x.path === "docs/features/two.md").disposition, "requires-owner-review");
});

test("missing docs link stays visible in report", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-coverage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "docs"));
  fs.mkdirSync(path.join(root, "wiki"));
  fs.writeFileSync(path.join(root, "docs", "README.md"), "# Doc");
  fs.writeFileSync(path.join(root, "wiki", "Home.md"), "[Old](https://github.com/Faysk/tda/blob/main/docs/deleted.md)");
  assert.deepEqual(auditWikiCoverage(root).unresolved, ["docs/deleted.md"]);
});

test("footer examples do not create false document ownership", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-coverage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "docs"));
  fs.mkdirSync(path.join(root, "wiki"));
  fs.writeFileSync(path.join(root, "docs", "README.md"),
    "# Example\n\n" + Array.from({ length: 40 }, () => "example line").join("\n") +
    "\n> Owner: illustrative\n> Última revisão: 2000-01-01\n");
  fs.writeFileSync(path.join(root, "wiki", "Home.md"), "# Wiki");
  const r = auditWikiCoverage(root);
  assert.equal(r.missingOwner, 1);
  assert.equal(r.missingReview, 1);
  assert.equal(r.sourceMatrix[0].owner, null);
});
