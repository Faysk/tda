import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planWikiSync } from "./sync-wiki.mjs";
import { verifyWikiBundle } from "./stage-wiki.mjs";

const sourceRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const wikiOrigin = /^(?:https:\/\/github\.com\/Faysk\/tda\.wiki\.git|git@github\.com:Faysk\/tda\.wiki\.git)$/i;

function refuse(reason) {
  throw new Error("WIKI_PREFLIGHT: " + reason);
}

function git(cwd, ...args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    refuse("Git command failed: " + args.join(" "));
  }
}

function cleanCheckout(cwd, description) {
  if (!fs.existsSync(path.join(cwd, ".git"))) refuse(description + " is not a Git checkout");
  if (git(cwd, "status", "--porcelain", "--untracked-files=all")) {
    refuse(description + " has local changes or untracked files");
  }
  return git(cwd, "rev-parse", "HEAD");
}

export function planWikiPublication(root, bundleDir, wikiDir, expectedWikiHead) {
  if (!/^[a-f0-9]{40}$/.test(expectedWikiHead)) refuse("expected Wiki HEAD must be a 40-character SHA");
  const bundle = verifyWikiBundle(bundleDir);
  const sourceSha = cleanCheckout(root, "source checkout");
  if (sourceSha !== bundle.sourceSha) refuse("bundle source SHA differs from checked-out source");
  const names = JSON.parse(fs.readFileSync(path.join(root, "tools/wiki/pages.json"), "utf8")).pages;
  const manifestNames = new Set(names.map((name) => name + ".md"));
  const receivedNames = fs.readdirSync(path.join(bundleDir, "pages"));
  if (receivedNames.length !== manifestNames.size || receivedNames.some((name) => !manifestNames.has(name))) {
    refuse("bundle pages differ from source allowlist");
  }
  for (const name of receivedNames) {
    if (!fs.readFileSync(path.join(root, "wiki", name)).equals(fs.readFileSync(path.join(bundleDir, "pages", name)))) {
      refuse("bundle page differs from reviewed source: " + name);
    }
  }

  const wikiSha = cleanCheckout(wikiDir, "Wiki checkout");
  if (wikiSha !== expectedWikiHead) refuse("Wiki HEAD differs from approved expected SHA");
  const origin = git(wikiDir, "remote", "get-url", "origin");
  if (!wikiOrigin.test(origin)) refuse("Wiki clone origin is not Faysk/tda.wiki.git");
  const branch = git(wikiDir, "symbolic-ref", "--short", "HEAD");
  const upstream = git(wikiDir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
  if (upstream !== "origin/" + branch) refuse("Wiki branch must track its corresponding origin branch");
  const trackedHead = git(wikiDir, "rev-parse", "@{upstream}");
  if (trackedHead !== wikiSha) refuse("Wiki clone is not at its last fetched upstream SHA");

  const plan = planWikiSync(root, wikiDir);
  return {
    sourceSha,
    wikiHead: wikiSha,
    wikiBranch: branch,
    targetRemote: origin,
    create: plan.actions.filter((p) => p.action === "create").map((p) => p.page),
    update: plan.actions.filter((p) => p.action === "update").map((p) => p.page),
    unchanged: plan.actions.filter((p) => p.action === "unchanged").map((p) => p.page),
    unmanagedPreserved: plan.otherFiles,
    warning: "Read-only preflight. Fetch origin again before staging and use non-force push. Does not establish current remote HEAD or publication.",
  };
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const index = args.indexOf(flag);
    if (index === -1 || !args[index + 1]) refuse("missing " + flag);
    return args[index + 1];
  };
  const result = planWikiPublication(
    sourceRoot, path.resolve(get("--bundle-dir")), path.resolve(get("--wiki-dir")), get("--expected-wiki-head"),
  );
  console.log("WIKI_PREFLIGHT_READ_ONLY " + JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
