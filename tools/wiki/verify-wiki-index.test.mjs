import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { applyWikiSync } from "./sync-wiki.mjs";
import { verifyWikiIndex } from "./verify-wiki-index.mjs";

function git(p, ...args) {
  return execFileSync("git", ["-C", p, ...args], { encoding: "utf8" }).trim();
}
function setup(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-index-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const source = path.join(base, "source"), wiki = path.join(base, "wiki");
  fs.mkdirSync(source); fs.mkdirSync(wiki);
  fs.mkdirSync(path.join(source, "wiki"));
  fs.mkdirSync(path.join(source, "docs"));
  fs.mkdirSync(path.join(source, "tools/wiki"), { recursive: true });
  fs.writeFileSync(path.join(source, "docs", "reference.md"), "# Canon");
  const pages = ["Home", "_Sidebar", "_Footer", "Indice"];
  const links = pages.map((n) => "https://github.com/Faysk/tda/wiki/" + n).join("\n");
  for (const slug of pages) {
    fs.writeFileSync(path.join(source, "wiki", slug + ".md"),
      (slug.startsWith("_") ? "## " : "# ") + slug +
      "\n\nA documented synthetic Wiki page for a reviewer.\n" +
      "https://github.com/Faysk/tda/blob/main/docs/reference.md\n" + links);
  }
  fs.writeFileSync(path.join(source, "tools/wiki/pages.json"), JSON.stringify({ pages, approvedMedia: [] }));
  for (const p of [source, wiki]) {
    git(p, "init", "-b", "main");
    git(p, "config", "user.name", "Test Wiki");
    git(p, "config", "user.email", "test@invalid.example");
  }
  git(source, "add", ".");
  git(source, "commit", "-m", "source");
  const sourceSha = git(source, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(wiki, "Human.md"), "# Existing human note");
  git(wiki, "add", ".");
  git(wiki, "commit", "-m", "initial");
  const wikiHead = git(wiki, "rev-parse", "HEAD");
  git(wiki, "remote", "add", "origin", "https://github.com/Faysk/tda.wiki.git");
  git(wiki, "update-ref", "refs/remotes/origin/main", wikiHead);
  git(wiki, "branch", "--set-upstream-to", "origin/main");
  applyWikiSync(source, wiki, sourceSha);
  return { source, wiki, sourceSha, wikiHead };
}

test("only approved pages and the state file are staged", (t) => {
  const f = setup(t);
  const result = verifyWikiIndex(f.source, f.wiki, f.sourceSha, f.wikiHead, { stage: true });
  assert.equal(result.pageCount, 4);
  assert.deepEqual(result.stagedPaths, [
    ".tda-wiki-sync-state.json", "Home.md", "Indice.md", "_Footer.md", "_Sidebar.md",
  ]);
  assert.equal(verifyWikiIndex(f.source, f.wiki, f.sourceSha, f.wikiHead).staged, false);
  assert.equal(git(f.wiki, "status", "--short").includes("Human.md"), false);
});

test("rejects unrelated staged markdown even if the rest of the index is correct", (t) => {
  const f = setup(t);
  verifyWikiIndex(f.source, f.wiki, f.sourceSha, f.wikiHead, { stage: true });
  fs.writeFileSync(path.join(f.wiki, "Unapproved.md"), "# Unapproved");
  git(f.wiki, "add", "Unapproved.md");
  assert.throws(() => verifyWikiIndex(f.source, f.wiki, f.sourceSha, f.wikiHead), /unexpected worktree or index file/);
});

test("rejects missing or unexpected Wiki HEAD", (t) => {
  const f = setup(t);
  assert.throws(() => verifyWikiIndex(f.source, f.wiki, f.sourceSha, "0".repeat(40), { stage: true }), /Wiki HEAD changed/);
});

test("rejects tampered content staged in place of approved source", (t) => {
  const f = setup(t);
  verifyWikiIndex(f.source, f.wiki, f.sourceSha, f.wikiHead, { stage: true });
  fs.writeFileSync(path.join(f.wiki, "Home.md"), "# Injected staged content");
  git(f.wiki, "add", "Home.md");
  assert.throws(() => verifyWikiIndex(f.source, f.wiki, f.sourceSha, f.wikiHead), /staged Wiki page differs/);
});

test("refuses staging extra notes added after sync", (t) => {
  const f = setup(t);
  fs.writeFileSync(path.join(f.wiki, "Secret.md"), "Unapproved");
  assert.throws(() => verifyWikiIndex(f.source, f.wiki, f.sourceSha, f.wikiHead, { stage: true }), /unexpected worktree or index file/);
});
