import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeWikiImpact } from "./impact.mjs";

test("lists all wiki guides referencing changed canonical docs", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-impact-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "wiki"));
  const url = "https://github.com/Faysk/tda/blob/main/docs/features/processing.md";
  fs.writeFileSync(path.join(root, "wiki", "Home.md"), "See " + url);
  fs.writeFileSync(path.join(root, "wiki", "Companion.md"), "Details " + url);
  const report = analyzeWikiImpact(root, ["docs/features/processing.md", "src/page.tsx", "docs/features/processing.md"]);
  assert.equal(report.changedDocs, 1);
  assert.deepEqual(report.impact[0].wikiPagesToReview, ["Companion", "Home"]);
});

test("reports unreferenced changed docs without marking wiki as wrong", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-impact-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "wiki"));
  fs.writeFileSync(path.join(root, "wiki", "Home.md"), "# Wiki");
  const report = analyzeWikiImpact(root, ["docs/features/unmentioned.md"]);
  assert.deepEqual(report.impact[0].wikiPagesToReview, []);
  assert.match(report.note, /does not automatically/);
});
