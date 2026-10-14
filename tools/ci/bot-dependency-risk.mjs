import { appendFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const critical = new Map([
  ["next", "Web routes/SSR"], ["react", "Web rendering"],
  ["react-dom", "Web rendering"], ["@supabase/supabase-js", "Auth/DB"],
  ["@aws-sdk/client-s3", "R2/media"], ["fastapi", "Companion HTTP/MSI"],
  ["ctranslate2", "Whisper/GPU"], ["torch", "Qwen/CUDA"],
  ["transformers", "Qwen inference"], ["faster-whisper", "Whisper/decoder"],
]);
const tooling = new Set(["@playwright/test", "typescript", "eslint", "pytest", "pyinstaller", "setuptools"]);

function safe(value) {
  return String(value).replace(/[\r\n|]/g, " ").replace(/\u0060/g, "'").slice(0, 200);
}
export function npmPins(text) {
  if (!text) return new Map();
  const json = JSON.parse(text);
  const result = new Map();
  for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])
    for (const [name, pin] of Object.entries(json[key] || {}))
      result.set(name.toLowerCase(), { pin: String(pin), scope: key });
  return result;
}
export function pythonPins(text) {
  const result = new Map();
  if (!text) return result;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*["']([a-z0-9_.-]+)==([a-z0-9.+_-]+)["'],?\s*$/i);
    if (match) result.set(match[1].toLowerCase().replaceAll("_", "-"), { pin: match[2], scope: "Python exact pin" });
  }
  return result;
}
// Normalize only recognized exact pins. If any other pyproject field,
// constraint, extra or script changes, the risk report must not say "none".
function normalizePythonManifest(text) {
  if (typeof text !== "string") return null;
  return text.replace(/^([ \t]*["'][a-z0-9_.-]+)==[a-z0-9.+_-]+(["'],?[ \t]*)$/gim,
    "$1==<exact-pin>$2");
}
// Replace only dependency values when comparing manifests: lifecycle scripts,
// engines, package-manager constraints and metadata changes must remain visible.
function normalizeNpmManifest(text) {
  if (typeof text !== "string") return null;
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  for (const scope of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (!Object.hasOwn(data, scope)) continue;
    const deps = data[scope];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) return null;
    for (const key of Object.keys(deps)) {
      if (typeof deps[key] !== "string") return null;
      deps[key] = "<dependency-pin>";
    }
  }
  const sorted = (value) => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
    return value;
  };
  return JSON.stringify(sorted(data));
}
export function versionKind(before, after) {
  // Capture the exact npm range operator separately from numeric SemVer.
  // A change from ~ to ^ (or exact to a range) can widen the permitted
  // dependency set even when the numeric change looks like a safe patch.
  const fullVersion = /^([~^v]?)(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
  const a = String(before).match(fullVersion);
  const b = String(after).match(fullVersion);
  if (!a || !b) return "unknown";
  if (before === after) return "same";
  if (a[1] !== b[1] || a[5] || b[5] || a[6] || b[6]) return "unknown";
  // A numeric downgrade can reintroduce earlier defects and vulnerabilities.
  const from = a.slice(2, 5).map(BigInt);
  const to = b.slice(2, 5).map(BigInt);
  for (let i = 0; i < from.length; i++) {
    if (to[i] < from[i]) return "downgrade";
    if (to[i] > from[i]) break;
  }
  if (a[2] !== b[2]) return "major";
  if (a[3] !== b[3]) return "minor";
  if (a[4] !== b[4]) return "patch";
  return "unknown";
}
function compare(before, after, ecosystem) {
  const out = [];
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const from = before.get(name), to = after.get(name);
    if (from?.pin === to?.pin) continue;
    const kind = !from ? "added" : !to ? "removed" : versionKind(from.pin, to.pin);
    const level = critical.has(name) || ["major", "unknown", "removed", "added", "downgrade"].includes(kind) ? "high" :
      tooling.has(name) || kind === "minor" ? "medium" : "low";
    out.push({ ecosystem, name, before: from?.pin || "-", after: to?.pin || "-",
      kind, level, reason: critical.get(name) || (tooling.has(name) ? "build/test tooling" : "dependency change") });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
export function classifyDependencyDiff({ oldNpm = null, newNpm = null, oldPython = null, newPython = null, paths = [] } = {}) {
  const files = [...new Set(paths.map((p) => String(p).replaceAll("\\", "/")))].sort();
  const findings = [
    ...compare(npmPins(oldNpm), npmPins(newNpm), "npm"),
    ...compare(pythonPins(oldPython), pythonPins(newPython), "pip"),
  ];
  // Direct manifest diffs are not a complete analysis of the transitive graph.
  // A lockfile can change unrelated packages alongside an ordinary patch.
  if (files.includes("pnpm-lock.yaml"))
    findings.push({ ecosystem: "npm", name: "transitive-lock", before: "unverified", after: "unverified",
      kind: "lock-unreviewed", level: "high",
      reason: "pnpm transitive graph not verified; direct pin changes do not clear lock risk" });
  if (files.includes("package.json") &&
      (typeof oldNpm !== "string" || typeof newNpm !== "string" ||
       normalizeNpmManifest(oldNpm) !== normalizeNpmManifest(newNpm))) {
    findings.push({ ecosystem: "npm", name: "package-json-unclassified", before: "unknown", after: "unknown",
      kind: "manifest-unclassified", level: "high",
      reason: "package.json scripts, engines, scope or metadata changed beyond dependency versions" });
  }
  if (files.includes("local-companion/requirements-test.lock"))
    findings.push({ ecosystem: "pip", name: "transitive-lock", before: "unverified", after: "unverified",
      kind: "lock-unreviewed", level: "high",
      reason: "Python resolved transitive lock not verified; direct pin changes do not clear lock risk" });
  if (files.includes("local-companion/pyproject.toml") &&
      (typeof oldPython !== "string" || typeof newPython !== "string" ||
       normalizePythonManifest(oldPython) !== normalizePythonManifest(newPython))) {
    findings.push({ ecosystem: "pip", name: "pyproject-unclassified", before: "unknown", after: "unknown",
      kind: "manifest-unclassified", level: "high",
      reason: "Python manifest has edits beyond recognized direct exact pins; review constraints, extras and scripts" });
  }
  for (const path of files.filter((p) => ["pnpm-workspace.yaml", ".npmrc"].includes(p))) {
    findings.push({ ecosystem: "npm", name: path, before: "configuration", after: "review required",
      kind: "package-manager-configuration", level: "high",
      reason: "Package-manager sources, lifecycle builds, registry or scripts configuration requires review" });
  }
  for (const path of files.filter((p) => /^\.github\/dependabot\.ya?ml$/.test(p))) {
    findings.push({ ecosystem: "github-actions", name: path, before: "review required", after: "review required",
      kind: "bot-configuration", level: "high",
      reason: "Dependabot schedule, update scopes and package groups require supply-chain review" });
  }
  for (const path of files.filter((p) => /^\.github\/workflows\/.+\.ya?ml$/.test(p)))
    findings.push({ ecosystem: "github-actions", name: path, before: "pinned", after: "review required",
      kind: "workflow", level: "high", reason: "Review triggers, permissions, provenance and SHA" });
  const priority = { low: 1, medium: 2, high: 3 };
  const risk = findings.reduce((a, f) => priority[f.level] > priority[a] ? f.level : a, "low");
  return {
    risk: findings.length ? risk : "none",
    recommendation: findings.length ? "human-review-required" : "no-dependency-change",
    checks: "not-queried", advisories: "not-queried", findings, files,
  };
}
export function renderRiskMarkdown(report, range = "unknown") {
  if (!report.findings.length) return "";
  const lines = [
    "## Dependency Risk Analyst (deterministic, advisory only)",
    "- Git range: " + safe(range),
    "- Impact: **" + report.risk + "** (not CVE severity)",
    "- Status: **human review required**; not permission to merge or publish.",
    "- CI checks and security advisories: **not queried** by this step.",
    "", "| Ecosystem | Package / file | Before → after | Change | Risk | Reason |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of report.findings)
    lines.push("| " + [r.ecosystem, r.name, r.before + " → " + r.after, r.kind, r.level, r.reason].map(safe).join(" | ") + " |");
  lines.push("", "Evidence: manifests/diff only. Runtime and Production acceptance remain independent.", "");
  return lines.join("\n");
}
function show(ref, path) {
  const response = spawnSync("git", ["show", ref + ":" + path], { encoding: "utf8" });
  if (response.status !== 0) return null;
  return response.stdout;
}
export function parseDiffRange(range, mergeBase) {
  const threeDot = String(range).includes("...");
  const parts = String(range).split(threeDot ? "..." : "..");
  if (parts.length !== 2 || !parts.every((ref) => /^[A-Za-z0-9_.\/^~+-]+$/.test(ref)))
    throw new Error("Exact Git diff range required");
  if (threeDot && !/^[a-f0-9]{40}$/.test(String(mergeBase)))
    throw new Error("Three-dot diff requires verified merge-base SHA");
  return {
    from: threeDot ? mergeBase : parts[0],
    to: parts[1],
    threeDot,
  };
}
function main() {
  const range = process.argv[2];
  // git diff A...B compares merge-base(A,B) with B; do not compare
  // manifests from A itself if main advanced after the PR branch forked.
  const isThreeDot = String(range).includes("...");
  const raw = String(range).split(isThreeDot ? "..." : "..");
  if (raw.length !== 2 || !raw.every((ref) => /^[A-Za-z0-9_.\/^~+-]+$/.test(ref)))
    throw new Error("Exact Git diff range required");
  const mergeBase = isThreeDot ?
    execFileSync("git", ["merge-base", raw[0], raw[1]], { encoding: "utf8" }).trim() : null;
  const refs = parseDiffRange(range, mergeBase);
  const files = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMRD", range], { encoding: "utf8" })
    .split(/\r?\n/).filter(Boolean);
  if (!files.some((f) => ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc",
    "local-companion/pyproject.toml", "local-companion/requirements-test.lock"].includes(f) ||
    /^\.github\/(?:workflows\/.+|dependabot)\.ya?ml$/.test(f))) return;
  const report = classifyDependencyDiff({
    oldNpm: show(refs.from, "package.json"), newNpm: show(refs.to, "package.json"),
    oldPython: show(refs.from, "local-companion/pyproject.toml"),
    newPython: show(refs.to, "local-companion/pyproject.toml"), paths: files,
  });
  const output = renderRiskMarkdown(report, range);
  if (output && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, output + "\n");
  if (output) process.stdout.write(output);
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
