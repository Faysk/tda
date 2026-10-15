import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkWiki } from "./check-wiki.mjs";

const rootDefault = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const stateName = ".tda-wiki-sync-state.json";
const wikiRemotePattern = /^(?:https:\/\/github\.com\/Faysk\/tda\.wiki\.git|git@github\.com:Faysk\/tda\.wiki\.git)$/i;

function reject(message) {
  throw new Error("WIKI_SYNC: " + message);
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readOptionalFile(file) {
  if (!fs.existsSync(file)) return null;
  if (!fs.lstatSync(file).isFile()) reject("expected regular file: " + file);
  return fs.readFileSync(file);
}

function parseState(targetDir) {
  const content = readOptionalFile(path.join(targetDir, stateName));
  if (!content) return { schemaVersion: 1, repository: "Faysk/tda", pages: {} };
  let state;
  try {
    state = JSON.parse(content.toString("utf8"));
  } catch {
    reject("invalid previous sync state JSON");
  }
  if (state.schemaVersion !== 1 || state.repository !== "Faysk/tda" ||
      typeof state.pages !== "object" || !state.pages || Array.isArray(state.pages)) {
    reject("unsupported or malformed previous sync state");
  }
  for (const [page, hash] of Object.entries(state.pages)) {
    if (!/^[A-Za-z0-9_-]+\.md$/.test(page) || !/^[a-f0-9]{64}$/.test(hash)) {
      reject("unsafe page/hash in previous sync state: " + page);
    }
  }
  return state;
}

export function readWikiAdoptionApprovals(filePath, expectedWikiHead) {
  if (!/^[a-f0-9]{40}$/.test(expectedWikiHead)) reject("expected Wiki SHA required for adoption");
  if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) {
    reject("adoption receipt must be a regular JSON file");
  }
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    reject("invalid adoption JSON");
  }
  if (receipt.schemaVersion !== 1 || receipt.repository !== "Faysk/tda" ||
      receipt.wikiHead !== expectedWikiHead || !receipt.pages ||
      typeof receipt.pages !== "object" || Array.isArray(receipt.pages) ||
      Object.keys(receipt.pages).length === 0) {
    reject("adoption receipt missing or mismatched Wiki HEAD/pages");
  }
  for (const [name, hash] of Object.entries(receipt.pages)) {
    if (!/^[A-Za-z0-9_-]+\.md$/.test(name) || !/^[a-f0-9]{64}$/.test(hash)) {
      reject("invalid adoption page/hash: " + name);
    }
  }
  return receipt.pages;
}

export function planWikiSync(sourceRoot, targetDir, { adoptions = {} } = {}) {
  checkWiki(sourceRoot);
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    reject("target Wiki clone directory does not exist");
  }
  const manifest = JSON.parse(fs.readFileSync(
    path.join(sourceRoot, "tools/wiki/pages.json"), "utf8",
  ));
  const state = parseState(targetDir);
  const allowed = new Set(manifest.pages.map((name) => name + ".md"));
  if (!adoptions || typeof adoptions !== "object" || Array.isArray(adoptions)) {
    reject("invalid adoption approvals");
  }
  for (const [name, hash] of Object.entries(adoptions)) {
    if (!allowed.has(name) || !/^[a-f0-9]{64}$/.test(hash)) reject("unapproved adoption: " + name);
  }

  // Deliberate removals need their own reviewed operation, not a blind mirror.
  for (const previous of Object.keys(state.pages)) {
    if (!allowed.has(previous)) reject("previously managed page removed from allowlist: " + previous);
  }

  const next = { schemaVersion: 1, repository: "Faysk/tda", pages: {} };
  const actions = [];
  for (const page of manifest.pages) {
    const name = page + ".md";
    const source = path.join(sourceRoot, "wiki", name);
    const destination = path.join(targetDir, name);
    const desired = fs.readFileSync(source);
    const wantedHash = digest(desired);
    const current = readOptionalFile(destination);
    const currentHash = current ? digest(current) : null;
    const managedHash = state.pages[name];

    let adopted = false;
    if (managedHash) {
      if (adoptions[name]) reject("adoption cannot override previously managed page: " + name);
      if (currentHash !== managedHash) {
        reject("Wiki page has manual drift or was removed; reconcile first: " + name);
      }
    } else if (current && currentHash !== wantedHash) {
      if (adoptions[name] !== currentHash) {
        reject("existing unmanaged Wiki page differs; refuse overwrite: " + name);
      }
      adopted = true;
    } else if (adoptions[name]) {
      reject("unused adoption approval for page: " + name);
    }
    next.pages[name] = wantedHash;
    actions.push({
      page: name,
      adopted,
      action: !current ? "create" : currentHash === wantedHash ? "unchanged" : "update",
    });
  }

  const otherFiles = fs.readdirSync(targetDir).filter((item) =>
    item !== ".git" && item !== stateName && !allowed.has(item),
  );
  return { actions, otherFiles, state: next };
}

export function applyWikiSync(sourceRoot, targetDir, sourceSha, options = {}) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) reject("exact 40-hex source SHA required for apply");
  const plan = planWikiSync(sourceRoot, targetDir, options);
  // Compute the entire plan first, before touching files. Git commit/push are separate.
  for (const { page, action } of plan.actions) {
    if (action === "unchanged") continue;
    const data = fs.readFileSync(path.join(sourceRoot, "wiki", page));
    fs.writeFileSync(path.join(targetDir, page), data, { flag: action === "create" ? "wx" : "w" });
  }
  fs.writeFileSync(path.join(targetDir, stateName), JSON.stringify({
    ...plan.state, sourceSha,
  }, null, 2) + "\n");
  return plan;
}

function git(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

function verifyClone(targetDir) {
  if (!fs.existsSync(path.join(targetDir, ".git"))) {
    reject("target must be a Git clone (no .git found)");
  }
  let origin;
  try {
    origin = git(targetDir, "remote", "get-url", "origin");
  } catch {
    reject("cannot read Wiki clone origin");
  }
  if (!wikiRemotePattern.test(origin)) {
    reject("target origin is not exactly the official Faysk/tda.wiki.git");
  }
  if (!git(targetDir, "symbolic-ref", "--short", "HEAD")) {
    reject("Wiki checkout is detached");
  }
  if (git(targetDir, "status", "--porcelain")) {
    reject("Wiki checkout has uncommitted changes; preserve/reconcile them first");
  }
}


function verifySourceRevision(sourceDir, sourceSha) {
  let actual;
  try {
    actual = git(sourceDir, "rev-parse", "HEAD");
  } catch {
    reject("source folder is not a valid Git checkout");
  }
  if (actual !== sourceSha) {
    reject("source SHA does not match the checked-out Git commit");
  }
  if (git(sourceDir, "status", "--porcelain", "--untracked-files=all")) {
    reject("source Git checkout is dirty; commit/review changes before staging");
  }
}

function main() {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--wiki-dir");
  const shaIdx = argv.indexOf("--source-sha");
  if (idx < 0 || !argv[idx + 1]) {
    reject("usage: node tools/wiki/sync-wiki.mjs --wiki-dir <local-wiki-clone> [--source-sha <40-hex>] [--apply]");
  }
  const targetDir = path.resolve(argv[idx + 1]);
  verifyClone(targetDir);
  const adoptIdx = argv.indexOf("--adopt-file");
  let adoptions = {};
  if (adoptIdx >= 0) {
    if (!argv[adoptIdx + 1]) reject("--adopt-file requires JSON path");
    const file = path.resolve(argv[adoptIdx + 1]);
    if (file.startsWith(rootDefault + path.sep) || file.startsWith(targetDir + path.sep)) {
      reject("adoption receipt must stay outside source and Wiki checkouts");
    }
    adoptions = readWikiAdoptionApprovals(file, git(targetDir, "rev-parse", "HEAD"));
  }
  const apply = argv.includes("--apply");
  if (apply) verifySourceRevision(rootDefault, shaIdx >= 0 ? argv[shaIdx + 1] : "");
  const plan = apply
    ? applyWikiSync(rootDefault, targetDir, shaIdx >= 0 ? argv[shaIdx + 1] : "", { adoptions })
    : planWikiSync(rootDefault, targetDir, { adoptions });
  console.log("WIKI_SYNC_" + (apply ? "STAGED" : "DRY_RUN") + " " + JSON.stringify({
    create: plan.actions.filter((x) => x.action === "create").map((x) => x.page),
    update: plan.actions.filter((x) => x.action === "update").map((x) => x.page),
    adopted: plan.actions.filter((x) => x.adopted).map((x) => x.page),
    unchanged: plan.actions.filter((x) => x.action === "unchanged").length,
    unmanagedPreserved: plan.otherFiles,
  }));
  if (apply) {
    console.log("Changes are LOCAL ONLY. Review 'git diff' and commit/push after approval.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
