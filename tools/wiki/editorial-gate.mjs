import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function fail(reason) { throw new Error("WIKI_EDITORIAL: " + reason); }
function isRealDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00.000Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function auditWikiEditorial(root = defaultRoot, { requireApproved = false } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "tools/wiki/pages.json"), "utf8"));
  const file = path.join(root, "tools/wiki/editorial-reviews.json");
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) fail("missing regular review register");
  const register = JSON.parse(fs.readFileSync(file, "utf8"));
  if (register.schemaVersion !== 1 || register.repository !== "Faysk/tda" ||
      !register.pages || typeof register.pages !== "object" || Array.isArray(register.pages)) {
    fail("invalid editorial register identity");
  }
  const expected = new Set(manifest.pages);
  const registered = Object.keys(register.pages);
  if (registered.length !== expected.size || registered.some(name => !expected.has(name))) {
    fail("editorial register and public-page allowlist differ");
  }
  const pending = [], approved = [], stale = [];
  for (const slug of manifest.pages) {
    const entry = register.pages[slug];
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).sort().join(",") !==
          ["status", "reviewer", "reviewedAt", "contentSha256", "evidence"].sort().join(",")) {
      fail("malformed review entry: " + slug);
    }
    const page = path.join(root, "wiki", slug + ".md");
    if (!fs.existsSync(page) || !fs.lstatSync(page).isFile()) fail("missing regular page: " + slug);
    const current = sha256(fs.readFileSync(page));
    if (entry.status === "pending") {
      if ([entry.reviewer, entry.reviewedAt, entry.contentSha256, entry.evidence].some(v => v !== null)) {
        fail("pending review cannot claim human approval metadata: " + slug);
      }
      pending.push(slug);
    } else if (entry.status === "approved") {
      if (typeof entry.reviewer !== "string" ||
          !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(entry.reviewer) ||
          !isRealDate(entry.reviewedAt) ||
          typeof entry.evidence !== "string" ||
          !/^https:\/\/github\.com\/Faysk\/tda\/(?:issues|pull)\/[1-9]\d*(?:#[A-Za-z0-9_-]+)?$/.test(entry.evidence) ||
          typeof entry.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.contentSha256)) {
        fail("approved review requires a dated reviewer, exact hash and project issue/PR evidence: " + slug);
      }
      if (current !== entry.contentSha256) stale.push(slug);
      else approved.push(slug);
    } else {
      fail("unsupported editorial state: " + slug);
    }
  }
  if (stale.length) fail("previous editorial approval is stale for changed pages: " + stale.join(", "));
  if (requireApproved && pending.length) {
    fail("pages still awaiting human editorial review: " + pending.join(", "));
  }
  return {
    pages: manifest.pages.length, approved: approved.length, pending: pending.length,
    pendingPages: pending, allApproved: pending.length === 0,
    note: "A registered review is a traceability signal, not independent proof of editor identity or GitHub Wiki rendering. Confirm review evidence and human usability before publish.",
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditWikiEditorial(defaultRoot, { requireApproved: process.argv.includes("--require-approved") });
  console.log("WIKI_EDITORIAL_REPORT " + JSON.stringify(report, null, 2));
}
