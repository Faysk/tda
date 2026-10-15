import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { planWikiSync, applyWikiSync } from "./sync-wiki.mjs";

const sha = "1".repeat(40);
const sourceLink = "https://github.com/Faysk/tda/blob/main/docs/reference.md";
const pageLink = (name) => "https://github.com/Faysk/tda/wiki/" + name;
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-sync-src-"));
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-sync-dst-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "wiki"));
  fs.mkdirSync(path.join(root, "tools", "wiki"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "docs", "reference.md"), "# canonical");
  const pages = ["Home", "_Sidebar", "_Footer", "Indice"];
  fs.writeFileSync(path.join(root, "tools", "wiki", "pages.json"),
    JSON.stringify({ pages, approvedMedia: [] }));
  for (const page of pages) {
    const title = page.startsWith("_") ? "## " + page : "# " + page;
    fs.writeFileSync(path.join(root, "wiki", page + ".md"),
      title + "\n\nA carefully written description of the project's work.\n\n" +
      sourceLink + "\n\n" + pages.map(pageLink).join("\n"));
  }
  return { root, remote };
}

test("plans a read-only initial sync and preserves unrelated pages", (t) => {
  const { root, remote } = setup(t);
  fs.writeFileSync(path.join(remote, "Unmanaged.md"), "# Human edit\n");
  const plan = planWikiSync(root, remote);
  assert.equal(plan.actions.filter(x => x.action === "create").length, 4);
  assert.deepEqual(plan.otherFiles, ["Unmanaged.md"]);
  assert.equal(fs.existsSync(path.join(remote, "Home.md")), false);
});

test("stages new pages, then clean repeat becomes no-op", (t) => {
  const { root, remote } = setup(t);
  const result = applyWikiSync(root, remote, sha);
  assert.equal(result.actions.length, 4);
  assert.equal(planWikiSync(root, remote).actions.filter(x => x.action === "unchanged").length, 4);
  const state = JSON.parse(fs.readFileSync(path.join(remote, ".tda-wiki-sync-state.json"), "utf8"));
  assert.equal(state.sourceSha, sha);
  assert.equal(Object.keys(state.pages).length, 4);
});

test("detects manual edits before writing any update", (t) => {
  const { root, remote } = setup(t);
  applyWikiSync(root, remote, sha);
  fs.appendFileSync(path.join(remote, "Home.md"), "\nManual change");
  fs.appendFileSync(path.join(root, "wiki", "Indice.md"), "\nAnother approved paragraph.");
  const unchanged = fs.readFileSync(path.join(remote, "Indice.md"), "utf8");
  assert.throws(() => applyWikiSync(root, remote, sha), /manual drift/);
  assert.equal(fs.readFileSync(path.join(remote, "Indice.md"), "utf8"), unchanged);
});

test("refuses replacing an unmanaged Wiki page", (t) => {
  const { root, remote } = setup(t);
  fs.writeFileSync(path.join(remote, "Home.md"), "# Existing human-authored page");
  assert.throws(() => planWikiSync(root, remote), /existing unmanaged/);
});

test("new sources can update only their previously managed pages", (t) => {
  const { root, remote } = setup(t);
  applyWikiSync(root, remote, sha);
  fs.appendFileSync(path.join(root, "wiki", "Home.md"), "\nA reviewed update to the Home page.");
  assert.equal(planWikiSync(root, remote).actions.find(x => x.page === "Home.md").action, "update");
  applyWikiSync(root, remote, sha);
  assert.match(fs.readFileSync(path.join(remote, "Home.md"), "utf8"), /reviewed update/);
});

test("unapproved page and invalid source revision both block stage", (t) => {
  const { root, remote } = setup(t);
  assert.throws(() => applyWikiSync(root, remote, "main"), /source SHA/);
  fs.writeFileSync(path.join(root, "wiki", "Hidden.md"), "# Secret\n\nNot approved for Wiki.");
  assert.throws(() => planWikiSync(root, remote), /manifest/);
});

test("symlinks cannot replace managed Wiki files", (t) => {
  const { root, remote } = setup(t);
  const external = path.join(remote, "other.md");
  fs.writeFileSync(external, "Do not overwrite");
  fs.symlinkSync(external, path.join(remote, "Home.md"));
  assert.throws(() => planWikiSync(root, remote), /regular file/);
});
