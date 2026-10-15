import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkWiki } from "./check-wiki.mjs";

const rootDefault = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const officialWiki = /^(?:https:\/\/github\.com\/Faysk\/tda\.wiki\.git|git@github\.com:Faysk\/tda\.wiki\.git)$/i;
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function refuse(why) {
  throw new Error("WIKI_READBACK: " + why);
}
function git(cwd, ...args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    refuse("git command failed: " + args.join(" "));
  }
}
function regularBytes(file) {
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) refuse("missing regular file: " + file);
  return fs.readFileSync(file);
}

export function verifyWikiReadback(sourceDir, wikiDir, sourceSha, wikiCommit) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || !/^[a-f0-9]{40}$/.test(wikiCommit)) {
    refuse("exact source SHA and Wiki commit SHA required");
  }
  checkWiki(sourceDir);
  if (git(sourceDir, "rev-parse", "HEAD") !== sourceSha) refuse("source checkout SHA mismatch");
  if (git(sourceDir, "status", "--porcelain", "--untracked-files=all")) {
    refuse("source checkout dirty");
  }
  if (git(wikiDir, "rev-parse", "HEAD") !== wikiCommit) refuse("published Wiki checkout SHA mismatch");
  if (git(wikiDir, "status", "--porcelain", "--untracked-files=all")) {
    refuse("Wiki readback checkout dirty");
  }
  if (!officialWiki.test(git(wikiDir, "remote", "get-url", "origin"))) {
    refuse("Wiki origin mismatch");
  }
  const branch = git(wikiDir, "symbolic-ref", "--short", "HEAD");
  const upstream = git(wikiDir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
  if (upstream !== "origin/" + branch || git(wikiDir, "rev-parse", "@{upstream}") !== wikiCommit) {
    refuse("Wiki readback differs from fetched upstream");
  }

  let state;
  try {
    state = JSON.parse(regularBytes(path.join(wikiDir, ".tda-wiki-sync-state.json")).toString("utf8"));
  } catch {
    refuse("invalid or missing Wiki sync state receipt");
  }
  if (state.schemaVersion !== 1 || state.repository !== "Faysk/tda" ||
      state.sourceSha !== sourceSha || !state.pages || typeof state.pages !== "object" ||
      Array.isArray(state.pages)) refuse("Wiki state does not match approved source");
  const manifest = JSON.parse(regularBytes(path.join(sourceDir, "tools/wiki/pages.json")).toString("utf8"));
  const names = manifest.pages.map((name) => name + ".md");
  const expected = new Set(names);
  if (Object.keys(state.pages).length !== expected.size ||
      Object.keys(state.pages).some((name) => !expected.has(name))) {
    refuse("Wiki sync state page set differs from allowlist");
  }
  for (const page of names) {
    const src = regularBytes(path.join(sourceDir, "wiki", page));
    const published = regularBytes(path.join(wikiDir, page));
    if (!src.equals(published) || state.pages[page] !== hash(src)) {
      refuse("published Wiki bytes/hash differ: " + page);
    }
  }
  return {
    sourceSha, wikiCommit,
    pages: names.length,
    note: "Git byte readback only; this does not prove GitHub Wiki UI rendering, links over HTTP, or editorial acceptance.",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (name) => {
    const i = args.indexOf(name);
    if (i < 0 || !args[i + 1]) refuse("missing " + name);
    return args[i + 1];
  };
  console.log("WIKI_READBACK_VERIFIED " + JSON.stringify(verifyWikiReadback(
    rootDefault, path.resolve(get("--wiki-dir")), get("--source-sha"), get("--wiki-commit"),
  )));
}
