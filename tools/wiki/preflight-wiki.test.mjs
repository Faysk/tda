import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { stageWikiBundle } from "./stage-wiki.mjs";
import { planWikiPublication } from "./preflight-wiki.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}
function init(cwd) {
  git(cwd, "init", "-b", "master");
  git(cwd, "config", "user.name", "Wiki synthetic tester");
  git(cwd, "config", "user.email", "synthetic@invalid.example");
}
function commit(cwd) {
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "synthetic source");
  return git(cwd, "rev-parse", "HEAD");
}
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tda-preflight-test-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, "source"), wiki = path.join(temp, "remote"), bundle = path.join(temp, "bundle");
  fs.mkdirSync(source); fs.mkdirSync(wiki);
  fs.mkdirSync(path.join(source, "wiki"));
  fs.mkdirSync(path.join(source, "docs"));
  fs.mkdirSync(path.join(source, "tools", "wiki"), { recursive: true });
  fs.writeFileSync(path.join(source, "docs", "reference.md"), "# Test contract");
  const names = ["Home", "_Sidebar", "_Footer", "Indice"];
  fs.writeFileSync(path.join(source, "tools", "wiki", "pages.json"), JSON.stringify({ pages: names, approvedMedia: [] }));
  const urls = names.map((n) => "https://github.com/Faysk/tda/wiki/" + n).join("\n");
  for (const name of names) {
    const title = name.startsWith("_") ? "## " : "# ";
    fs.writeFileSync(path.join(source, "wiki", name + ".md"),
      title + name + "\n\nAn accessible synthetic user guide.\n\n" + urls +
      "\nhttps://github.com/Faysk/tda/blob/main/docs/reference.md\n");
  }
  init(source);
  const sha = commit(source);
  stageWikiBundle(source, bundle, sha);
  init(wiki);
  fs.writeFileSync(path.join(wiki, "Pre-existing.md"), "# Keep existing Wiki pages\n");
  const wikiHead = commit(wiki);
  git(wiki, "remote", "add", "origin", "https://github.com/Faysk/tda.wiki.git");
  git(wiki, "update-ref", "refs/remotes/origin/master", wikiHead);
  git(wiki, "branch", "--set-upstream-to", "origin/master");
  return { source, wiki, bundle, sha, wikiHead };
}

test("read-only preflight checks source, signed-off Wiki HEAD and preserves unrelated page", (t) => {
  const f = fixture(t);
  const p = planWikiPublication(f.source, f.bundle, f.wiki, f.wikiHead);
  assert.equal(p.sourceSha, f.sha);
  assert.equal(p.wikiHead, f.wikiHead);
  assert.equal(p.create.length, 4);
  assert.deepEqual(p.unmanagedPreserved, ["Pre-existing.md"]);
  assert.equal(fs.existsSync(path.join(f.wiki, "Home.md")), false);
});

test("rejects unexpected current Wiki HEAD", (t) => {
  const f = fixture(t);
  assert.throws(() => planWikiPublication(f.source, f.bundle, f.wiki, "0".repeat(40)), /Wiki HEAD differs/);
});

test("rejects dirty Wiki checkout", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.wiki, "New-human-page.md"), "Do not overwrite");
  assert.throws(() => planWikiPublication(f.source, f.bundle, f.wiki, f.wikiHead), /Wiki checkout has local changes/);
});

test("rejects stale tracked remote even if expected HEAD was supplied", (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.wiki, "Pre-existing.md"), "\nEdited");
  const newHead = commit(f.wiki);
  assert.throws(() => planWikiPublication(f.source, f.bundle, f.wiki, newHead), /last fetched upstream SHA/);
});

test("rejects forged origin and tampered bundle bytes", (t) => {
  const f = fixture(t);
  git(f.wiki, "remote", "set-url", "origin", "https://github.com/someone/other.wiki.git");
  assert.throws(() => planWikiPublication(f.source, f.bundle, f.wiki, f.wikiHead), /origin is not/);
  git(f.wiki, "remote", "set-url", "origin", "https://github.com/Faysk/tda.wiki.git");
  fs.appendFileSync(path.join(f.bundle, "pages", "Home.md"), "\nTampered");
  assert.throws(() => planWikiPublication(f.source, f.bundle, f.wiki, f.wikiHead), /bundle content drift/);
});

test("refuses bundle created from a different source SHA", (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.source, "docs", "reference.md"), "\nUpdated");
  commit(f.source);
  assert.throws(() => planWikiPublication(f.source, f.bundle, f.wiki, f.wikiHead), /bundle source SHA differs/);
});

test("stops when an existing unmanaged Wiki Home conflicts", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.wiki, "Home.md"), "# Keep actual Wiki Home");
  const newHead = commit(f.wiki);
  git(f.wiki, "update-ref", "refs/remotes/origin/master", newHead);
  assert.throws(() => planWikiPublication(f.source, f.bundle, f.wiki, newHead), /existing unmanaged Wiki page differs/);
});


test("preflight admits approved initial Home adoption only at exact Wiki HEAD", (t) => {
  const f = fixture(t);
  const existing = "# Existing Home\n\nReviewed manually before adoption.";
  fs.writeFileSync(path.join(f.wiki, "Home.md"), existing);
  const next = commit(f.wiki);
  git(f.wiki, "update-ref", "refs/remotes/origin/master", next);
  const hash = createHash("sha256").update(existing).digest("hex");
  assert.throws(() => planWikiPublication(f.source, f.bundle, f.wiki, next),
    /existing unmanaged Wiki page differs/);
  const r = planWikiPublication(f.source, f.bundle, f.wiki, next,
    { adoptions: { "Home.md": hash } });
  assert.deepEqual(r.adopted, ["Home.md"]);
  assert.match(fs.readFileSync(path.join(f.wiki, "Home.md"), "utf8"), /Existing Home/);
});
