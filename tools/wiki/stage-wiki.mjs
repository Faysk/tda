import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkWiki } from "./check-wiki.mjs";

const defaultRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function fail(message) {
  throw new Error("WIKI_BUNDLE: " + message);
}

export function verifyWikiBundle(bundleDir) {
  const receiptPath = path.join(bundleDir, "receipt.json");
  if (!fs.existsSync(receiptPath) || !fs.lstatSync(receiptPath).isFile()) fail("missing regular receipt");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  if (receipt.formatVersion !== 1 || receipt.repository !== "Faysk/tda" ||
      !/^[a-f0-9]{40}$/.test(receipt.sourceSha) || !Array.isArray(receipt.pages)) {
    fail("invalid bundle identity");
  }
  const dir = path.join(bundleDir, "pages");
  if (!fs.lstatSync(dir).isDirectory()) fail("pages must be a directory");
  const expected = new Set();
  for (const p of receipt.pages) {
    if (typeof p.name !== "string" || !/^[A-Za-z0-9_-]+\.md$/.test(p.name) ||
        !/^[a-f0-9]{64}$/.test(p.sha256) || !Number.isSafeInteger(p.bytes) || p.bytes < 1 ||
        expected.has(p.name)) fail("invalid or duplicate page receipt");
    expected.add(p.name);
    const file = path.join(dir, p.name);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) fail("missing regular page: " + p.name);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== p.bytes || sha256(bytes) !== p.sha256) fail("bundle content drift: " + p.name);
  }
  const found = fs.readdirSync(dir).sort();
  if (found.length !== expected.size || found.some((f) => !expected.has(f))) {
    fail("unapproved page in staged bundle");
  }
  const top = fs.readdirSync(bundleDir).sort();
  if (top.join(",") !== "pages,receipt.json") fail("bundle contains unexpected files");
  return { sourceSha: receipt.sourceSha, pages: expected.size };
}

export function stageWikiBundle(root, destination, sourceSha) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) fail("40-character source SHA required");
  checkWiki(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "tools/wiki/pages.json"), "utf8"));
  if (fs.existsSync(destination)) fail("destination already exists; refuse overwrite");
  fs.mkdirSync(destination, { mode: 0o700 });
  try {
    const output = path.join(destination, "pages");
    fs.mkdirSync(output);
    const pages = [];
    for (const slug of manifest.pages) {
      const name = slug + ".md";
      const source = path.join(root, "wiki", name);
      const bytes = fs.readFileSync(source);
      fs.writeFileSync(path.join(output, name), bytes, { flag: "wx" });
      pages.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
    }
    const receipt = {
      formatVersion: 1,
      repository: "Faysk/tda",
      sourceSha,
      pages,
    };
    fs.writeFileSync(path.join(destination, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    verifyWikiBundle(destination);
    return { destination, sourceSha, pages: pages.length };
  } catch (error) {
    // Only remove the directory created exclusively by this function.
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--out");
  if (i < 0 || !args[i + 1]) fail("usage: node tools/wiki/stage-wiki.mjs --out <new-absolute-path>");
  const out = path.resolve(args[i + 1]);
  if (!path.isAbsolute(args[i + 1])) fail("--out must be absolute");
  if (out === defaultRoot || out.startsWith(defaultRoot + path.sep)) {
    fail("stage output must be outside source checkout");
  }
  const sourceSha = git(defaultRoot, "rev-parse", "HEAD");
  // A commit SHA cannot attest local modifications. Refuse to stage edited wiki bytes.
  if (git(defaultRoot, "status", "--porcelain", "--", "wiki/", "tools/wiki/pages.json")) {
    fail("wiki source has uncommitted changes");
  }
  const result = stageWikiBundle(defaultRoot, out, sourceSha);
  console.log("WIKI_BUNDLE_STAGED " + JSON.stringify(result));
  console.log("No Wiki remote commit, push, deploy, or database operation performed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
