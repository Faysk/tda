import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { applyWikiSync, planWikiSync } from "./sync-wiki.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function configure(cwd) {
  git(cwd, "config", "user.name", "Synthetic Wiki maintainer");
  git(cwd, "config", "user.email", "wiki-test@invalid.example");
}
function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-git-flow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const upstream = path.join(root, "wiki.git");
  const source = path.join(root, "source");
  const wiki = path.join(root, "wiki-clone");
  fs.mkdirSync(source);
  fs.mkdirSync(path.join(source, "wiki"));
  fs.mkdirSync(path.join(source, "docs"));
  fs.mkdirSync(path.join(source, "tools", "wiki"), { recursive: true });
  fs.writeFileSync(path.join(source, "docs", "canonical.md"), "# Public canonical source\n");
  const slugs = ["Home", "_Sidebar", "_Footer", "Indice"];
  fs.writeFileSync(path.join(source, "tools", "wiki", "pages.json"),
    JSON.stringify({ pages: slugs, approvedMedia: [] }));
  const canonical = "https://github.com/Faysk/tda/blob/main/docs/canonical.md";
  const nav = slugs.map((slug) => "https://github.com/Faysk/tda/wiki/" + slug).join("\n");
  for (const slug of slugs) {
    const h = slug.startsWith("_") ? "## " : "# ";
    fs.writeFileSync(path.join(source, "wiki", slug + ".md"),
      h + slug + "\n\nSynthetic public documentation for safe Git workflow.\n" + canonical + "\n" + nav);
  }

  fs.mkdirSync(upstream);
  git(upstream, "init", "--bare", "--initial-branch=main");
  git(root, "clone", upstream, wiki);
  configure(wiki);
  fs.writeFileSync(path.join(wiki, "Preserved.md"), "# Existing human page\n\nNever delete blindly.\n");
  git(wiki, "add", "Preserved.md");
  git(wiki, "commit", "-m", "Seed preserved page");
  git(wiki, "push", "origin", "main");
  return { root, upstream, source, wiki, slugs };
}

function stageAndCommit(f) {
  const plan = planWikiSync(f.source, f.wiki);
  assert.deepEqual(plan.otherFiles, ["Preserved.md"]);
  applyWikiSync(f.source, f.wiki, "a".repeat(40));
  git(f.wiki, "add", "--", ...f.slugs.map((slug) => slug + ".md"), ".tda-wiki-sync-state.json");
  git(f.wiki, "commit", "-m", "Publish synthetic TDA Wiki content");
  return git(f.wiki, "rev-parse", "HEAD");
}

test("synthetic Wiki push/readback preserves unmanaged pages and receipt", (t) => {
  const f = makeFixture(t);
  const sourceHome = fs.readFileSync(path.join(f.source, "wiki", "Home.md"), "utf8");
  const publishedSha = stageAndCommit(f);
  git(f.wiki, "push", "origin", "main");
  const readback = path.join(f.root, "readback");
  git(f.root, "clone", f.upstream, readback);
  assert.equal(git(readback, "rev-parse", "HEAD"), publishedSha);
  assert.equal(fs.readFileSync(path.join(readback, "Home.md"), "utf8"), sourceHome);
  assert.match(fs.readFileSync(path.join(readback, "Preserved.md"), "utf8"), /Never delete blindly/);
  const state = JSON.parse(fs.readFileSync(path.join(readback, ".tda-wiki-sync-state.json"), "utf8"));
  assert.equal(state.sourceSha, "a".repeat(40));
  assert.equal(Object.keys(state.pages).length, 4);
});

test("synthetic non-force push rejects stale concurrent Wiki writer", (t) => {
  const f = makeFixture(t);
  const stale = path.join(f.root, "stale-clone");
  git(f.root, "clone", f.upstream, stale);
  configure(stale);
  stageAndCommit(f);
  git(f.wiki, "push", "origin", "main");
  fs.writeFileSync(path.join(stale, "Manual.md"), "# Concurrent manual edit\n");
  git(stale, "add", "Manual.md");
  git(stale, "commit", "-m", "Stale update");
  assert.throws(() => git(stale, "push", "origin", "main"), /Command failed/);
  assert.equal(git(f.upstream, "rev-parse", "refs/heads/main"), git(f.wiki, "rev-parse", "HEAD"));
});

test("synthetic revert restores the original Wiki content without force-push", (t) => {
  const f = makeFixture(t);
  stageAndCommit(f);
  git(f.wiki, "push", "origin", "main");
  const publishedSha = git(f.wiki, "rev-parse", "HEAD");
  git(f.wiki, "revert", "--no-edit", publishedSha);
  git(f.wiki, "push", "origin", "main");
  const check = path.join(f.root, "after-revert");
  git(f.root, "clone", f.upstream, check);
  assert.equal(fs.existsSync(path.join(check, "Home.md")), false);
  assert.equal(fs.existsSync(path.join(check, ".tda-wiki-sync-state.json")), false);
  assert.equal(fs.readFileSync(path.join(check, "Preserved.md"), "utf8"),
    "# Existing human page\n\nNever delete blindly.\n");
  assert.notEqual(git(f.upstream, "rev-parse", "HEAD"), publishedSha);
});
