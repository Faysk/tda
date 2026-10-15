import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { applyWikiSync } from "./sync-wiki.mjs";
import { verifyWikiReadback } from "./verify-wiki.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}
function init(p) {
  git(p, "init", "-b", "main");
  git(p, "config", "user.name", "Synthetic Wiki QA");
  git(p, "config", "user.email", "test@invalid.example");
}
function commit(p) {
  git(p, "add", ".");
  git(p, "commit", "-m", "synthetic");
  return git(p, "rev-parse", "HEAD");
}
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-readback-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const src = path.join(base, "source"), wiki = path.join(base, "wiki");
  fs.mkdirSync(src);
  fs.mkdirSync(wiki);
  fs.mkdirSync(path.join(src, "wiki"));
  fs.mkdirSync(path.join(src, "tools/wiki"), { recursive: true });
  fs.mkdirSync(path.join(src, "docs"));
  fs.writeFileSync(path.join(src, "docs/ref.md"), "# Reference");
  const slugs = ["Home", "_Sidebar", "_Footer", "Indice"];
  fs.writeFileSync(path.join(src, "tools/wiki/pages.json"), JSON.stringify({ pages: slugs, approvedMedia: [] }));
  const wikiLinks = slugs.map((x) => "https://github.com/Faysk/tda/wiki/" + x).join("\n");
  for (const page of slugs) {
    fs.writeFileSync(path.join(src, "wiki", page + ".md"),
      (page.startsWith("_") ? "## " : "# ") + page +
      "\n\nA detailed synthetic public example.\n" +
      "https://github.com/Faysk/tda/blob/main/docs/ref.md\n" + wikiLinks);
  }
  init(src);
  const sourceSha = commit(src);
  init(wiki);
  fs.writeFileSync(path.join(wiki, "Unmanaged.md"), "# Preserve this");
  commit(wiki);
  applyWikiSync(src, wiki, sourceSha);
  const wikiCommit = commit(wiki);
  git(wiki, "remote", "add", "origin", "https://github.com/Faysk/tda.wiki.git");
  git(wiki, "update-ref", "refs/remotes/origin/main", wikiCommit);
  git(wiki, "branch", "--set-upstream-to", "origin/main");
  return { src, wiki, sourceSha, wikiCommit };
}

test("valid source, receipt and tracked Wiki Git snapshot produce positive readback", (t) => {
  const f = fixture(t);
  const r = verifyWikiReadback(f.src, f.wiki, f.sourceSha, f.wikiCommit);
  assert.equal(r.pages, 4);
  assert.equal(r.wikiCommit, f.wikiCommit);
  assert.match(r.note, /does not prove GitHub Wiki UI/);
});
test("changing the published Home invalidates readback", (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.wiki, "Home.md"), "\nManual drift");
  assert.throws(() => verifyWikiReadback(f.src, f.wiki, f.sourceSha, f.wikiCommit), /Wiki readback checkout dirty/);
});
test("forged Wiki state SHA does not pass readback", (t) => {
  const f = fixture(t);
  const receipt = path.join(f.wiki, ".tda-wiki-sync-state.json");
  const state = JSON.parse(fs.readFileSync(receipt, "utf8"));
  state.sourceSha = "a".repeat(40);
  fs.writeFileSync(receipt, JSON.stringify(state));
  const changed = commit(f.wiki);
  git(f.wiki, "update-ref", "refs/remotes/origin/main", changed);
  assert.throws(() => verifyWikiReadback(f.src, f.wiki, f.sourceSha, changed), /state does not match approved source/);
});
test("remote tracking differing from readback HEAD is rejected", (t) => {
  const f = fixture(t);
  git(f.wiki, "update-ref", "refs/remotes/origin/main", "a".repeat(40));
  assert.throws(() => verifyWikiReadback(f.src, f.wiki, f.sourceSha, f.wikiCommit), /differs from fetched upstream/);
});
test("unapproved extra page in sync receipt does not pass", (t) => {
  const f = fixture(t);
  const receipt = path.join(f.wiki, ".tda-wiki-sync-state.json");
  const state = JSON.parse(fs.readFileSync(receipt, "utf8"));
  state.pages["Private.md"] = "b".repeat(64);
  fs.writeFileSync(receipt, JSON.stringify(state));
  const changed = commit(f.wiki);
  git(f.wiki, "update-ref", "refs/remotes/origin/main", changed);
  assert.throws(() => verifyWikiReadback(f.src, f.wiki, f.sourceSha, changed), /page set differs/);
});
