import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stageWikiBundle, verifyWikiBundle } from "./stage-wiki.mjs";

const sha = "a".repeat(40);
function sourceFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-bundle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "wiki"));
  fs.mkdirSync(path.join(root, "tools", "wiki"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "docs", "source.md"), "# Reference");
  const names = ["Home", "Indice", "_Sidebar", "_Footer"];
  const wikiUrls = names.map(n => "https://github.com/Faysk/tda/wiki/" + n).join("\n");
  for (const name of names) {
    const header = name.startsWith("_") ? "## " : "# ";
    fs.writeFileSync(path.join(root, "wiki", name + ".md"),
      header + name + "\n\nA legitimate overview of the TDA Wiki.\n" +
      "https://github.com/Faysk/tda/blob/main/docs/source.md\n" + wikiUrls);
  }
  fs.writeFileSync(path.join(root, "tools", "wiki", "pages.json"),
    JSON.stringify({ pages: names, approvedMedia: [] }));
  return root;
}

test("stages exactly allowlisted pages and a hash receipt", (t) => {
  const root = sourceFixture(t);
  const dest = path.join(root, "out");
  const result = stageWikiBundle(root, dest, sha);
  assert.equal(result.pages, 4);
  assert.equal(verifyWikiBundle(dest).sourceSha, sha);
  assert.equal(fs.readdirSync(path.join(dest, "pages")).length, 4);
  assert.equal(fs.existsSync(path.join(dest, "docs")), false);
});

test("refuses overwriting an existing bundle", (t) => {
  const root = sourceFixture(t);
  const dest = path.join(root, "out");
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, "README.md"), "Keep this");
  assert.throws(() => stageWikiBundle(root, dest, sha), /refuse overwrite/);
  assert.equal(fs.readFileSync(path.join(dest, "README.md"), "utf8"), "Keep this");
});

test("detects tampering after stage without weakening receipt", (t) => {
  const root = sourceFixture(t);
  const dest = path.join(root, "out");
  stageWikiBundle(root, dest, sha);
  fs.appendFileSync(path.join(dest, "pages", "Home.md"), "\nAltered");
  assert.throws(() => verifyWikiBundle(dest), /content drift/);
});

test("refuses an extra unapproved file in the staged package", (t) => {
  const root = sourceFixture(t);
  const dest = path.join(root, "out");
  stageWikiBundle(root, dest, sha);
  fs.writeFileSync(path.join(dest, "pages", "Private.md"), "Unapproved");
  assert.throws(() => verifyWikiBundle(dest), /unapproved page/);
});

test("refuses invalid source SHA and unsafe source file", (t) => {
  const root = sourceFixture(t);
  assert.throws(() => stageWikiBundle(root, path.join(root, "out"), "main"), /source SHA/);
  fs.writeFileSync(path.join(root, "wiki", "Secret.md"), "# Secret\nNot approved");
  assert.throws(() => stageWikiBundle(root, path.join(root, "out"), sha), /manifest/);
});
