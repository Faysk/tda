import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkWiki } from "./check-wiki.mjs";

const sourceRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const officialWiki = /^(?:https:\/\/github\.com\/Faysk\/tda\.wiki\.git|git@github\.com:Faysk\/tda\.wiki\.git)$/i;
const stateFile = ".tda-wiki-sync-state.json";
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function refuse(reason) {
  throw new Error("WIKI_INDEX: " + reason);
}
function git(cwd, args, encoding = "utf8") {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    refuse("Git command failed: " + args.join(" "));
  }
}
function names0(cwd, args) {
  return git(cwd, args).split("\0").filter(Boolean);
}
function bytes(file) {
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
    refuse("not a regular Wiki file: " + file);
  }
  return fs.readFileSync(file);
}
function snapshot(source, wiki, sourceSha, expectedWikiHead) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || !/^[a-f0-9]{40}$/.test(expectedWikiHead)) {
    refuse("source SHA and expected Wiki HEAD must be exact 40-character hashes");
  }
  checkWiki(source);
  if (git(source, ["rev-parse", "HEAD"]).trim() !== sourceSha ||
      git(source, ["status", "--porcelain", "--untracked-files=all"]).trim()) {
    refuse("source must be the clean reviewed commit");
  }
  if (git(wiki, ["rev-parse", "HEAD"]).trim() !== expectedWikiHead) {
    refuse("Wiki HEAD changed since approval");
  }
  if (!officialWiki.test(git(wiki, ["remote", "get-url", "origin"]).trim())) {
    refuse("Wiki origin differs from the official repository");
  }
  const branch = git(wiki, ["symbolic-ref", "--short", "HEAD"]).trim();
  const upstream = git(wiki, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).trim();
  if (upstream !== "origin/" + branch ||
      git(wiki, ["rev-parse", "@{upstream}"]).trim() !== expectedWikiHead) {
    refuse("Wiki HEAD does not match its fetched upstream");
  }
  const manifest = JSON.parse(bytes(path.join(source, "tools/wiki/pages.json")).toString("utf8"));
  const pages = manifest.pages.map((slug) => slug + ".md");
  return { pages, allowed: new Set([...pages, stateFile]) };
}
function checkReceipt(state, pages, source, sourceSha) {
  if (state.schemaVersion !== 1 || state.repository !== "Faysk/tda" ||
      state.sourceSha !== sourceSha || !state.pages || typeof state.pages !== "object" ||
      Array.isArray(state.pages) || Object.keys(state.pages).length !== pages.length) {
    refuse("staged Wiki state receipt differs from the approved source");
  }
  const pageSet = new Set(pages);
  for (const name of Object.keys(state.pages)) {
    if (!pageSet.has(name)) refuse("unapproved page in staged receipt: " + name);
  }
  for (const name of pages) {
    const content = bytes(path.join(source, "wiki", name));
    if (state.pages[name] !== sha256(content)) refuse("receipt hash mismatch: " + name);
  }
}

export function verifyWikiIndex(source, wiki, sourceSha, expectedWikiHead, { stage = false } = {}) {
  const { pages, allowed } = snapshot(source, wiki, sourceSha, expectedWikiHead);
  const staged = names0(wiki, ["diff", "--cached", "--name-only", "-z"]);
  const unstaged = names0(wiki, ["diff", "--name-only", "-z"]);
  const untracked = names0(wiki, ["ls-files", "--others", "--exclude-standard", "-z"]);
  for (const name of [...staged, ...unstaged, ...untracked]) {
    if (!allowed.has(name)) refuse("unexpected worktree or index file: " + name);
  }
  for (const name of [...pages, stateFile]) bytes(path.join(wiki, name));

  if (stage) {
    if (staged.length) refuse("index already contains changes; review/unstage first");
    const localState = JSON.parse(bytes(path.join(wiki, stateFile)).toString("utf8"));
    checkReceipt(localState, pages, source, sourceSha);
    for (const name of pages) {
      if (!bytes(path.join(wiki, name)).equals(bytes(path.join(source, "wiki", name)))) {
        refuse("working Wiki page differs from approved source: " + name);
      }
    }
    // Stage only allowlisted content plus state. Never stage '*' or unrelated notes.
    git(wiki, ["add", "--", ...pages, stateFile]);
  }
  const finalStaged = names0(wiki, ["diff", "--cached", "--name-only", "-z"]);
  if (!finalStaged.length) refuse("no staged changes to publish");
  if (names0(wiki, ["diff", "--cached", "--diff-filter=D", "--name-only", "-z"]).length) {
    refuse("staged deletions are not supported");
  }
  if (finalStaged.some((name) => !allowed.has(name))) refuse("unapproved path is staged");
  if (names0(wiki, ["diff", "--name-only", "-z"]).length ||
      names0(wiki, ["ls-files", "--others", "--exclude-standard", "-z"]).length) {
    refuse("Wiki checkout contains unreviewed unstaged or untracked work");
  }
  const indexedState = JSON.parse(git(wiki, ["show", ":" + stateFile]).toString("utf8"));
  checkReceipt(indexedState, pages, source, sourceSha);
  for (const page of pages) {
    if (!git(wiki, ["show", ":" + page], null).equals(bytes(path.join(source, "wiki", page)))) {
      refuse("staged Wiki page differs from approved source: " + page);
    }
  }
  return {
    sourceSha, expectedWikiHead,
    stagedPaths: finalStaged,
    pageCount: pages.length,
    staged: stage,
    message: "Git INDEX only. Review cached diff and commit/push separately. No Wiki remote write performed.",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n) => {
    const i = args.indexOf(n);
    if (i < 0 || !args[i + 1]) refuse("missing " + n);
    return args[i + 1];
  };
  const result = verifyWikiIndex(sourceRoot, path.resolve(opt("--wiki-dir")),
    opt("--source-sha"), opt("--expected-wiki-head"), { stage: args.includes("--stage") });
  console.log("WIKI_INDEX_" + (result.staged ? "STAGED" : "VERIFIED") + " " + JSON.stringify(result));
}
