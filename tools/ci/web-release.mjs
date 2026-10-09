import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const CHANNELS = Object.freeze({
  preview: { prefix: "Pre_", prerelease: true },
  production: { prefix: "Prod_", prerelease: false },
});
export const isExactSha = (sha) => typeof sha === "string" && SHA_PATTERN.test(sha);

export function parseWebTag(tag, channel) {
  const info = CHANNELS[channel];
  if (!info || typeof tag !== "string" || !tag.startsWith(info.prefix)) return null;
  const version = tag.slice(info.prefix.length);
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(version);
  if (!match) return null;
  const numbers = match.slice(1).map(Number);
  if (numbers.some((number) => !Number.isSafeInteger(number))) return null;
  return numbers;
}

export function latestWebTag(tags, channel) {
  const parsed = tags
    .map((tag) => ({ tag, version: parseWebTag(tag, channel) }))
    .filter((entry) => entry.version !== null)
    .sort((a, b) =>
      (b.version[0] - a.version[0]) ||
      (b.version[1] - a.version[1]) ||
      (b.version[2] - a.version[2]));
  return parsed[0]?.tag ?? null;
}

export function nextWebTag(tags, channel) {
  if (!CHANNELS[channel]) throw new Error("INVALID_WEB_RELEASE_CHANNEL");
  const latest = latestWebTag(tags, channel);
  if (!latest) return `${CHANNELS[channel]?.prefix ?? ""}1.0.0`;
  const parts = parseWebTag(latest, channel);
  if (parts[2] >= Number.MAX_SAFE_INTEGER) throw new Error("WEB_RELEASE_PATCH_OVERFLOW");
  return `${CHANNELS[channel].prefix}${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

function runGh(...args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function apiJson(endpoint) {
  return JSON.parse(runGh("api", endpoint));
}
function releaseForTag(repo, tag) {
  return apiJson(`repos/${repo}/releases/tags/${tag}`);
}
function shaForTag(repo, tag) {
  const value = apiJson(`repos/${repo}/git/ref/tags/${tag}`);
  if (value.object?.type !== "commit" || !isExactSha(value.object?.sha)) {
    throw new Error("WEB_RELEASE_TAG_MUST_POINT_TO_COMMIT");
  }
  return value.object.sha;
}
function allChannelTags(repo, channel) {
  const prefix = CHANNELS[channel]?.prefix;
  if (!prefix) throw new Error("INVALID_WEB_RELEASE_CHANNEL");
  const refs = apiJson(`repos/${repo}/git/matching-refs/tags/${prefix}`);
  if (!Array.isArray(refs)) throw new Error("INVALID_WEB_RELEASE_TAG_RESPONSE");
  return refs
    .map((ref) => ref.ref?.replace(/^refs\/tags\//, ""))
    .filter((name) => parseWebTag(name, channel) !== null);
}
function createGitHubRelease({ repo, tag, sha, channel, notes }) {
  const path = `web-release-notes-${channel}.md`;
  writeFileSync(path, notes, { flag: "wx" });
  try {
    const args = ["release", "create", tag, "--repo", repo,
      "--target", sha, "--title", tag, "--notes-file", path];
    if (CHANNELS[channel].prerelease) args.push("--prerelease");
    else args.push("--latest");
    runGh(...args);
  } finally {
    unlinkSync(path);
  }
}

function deletePriorWebReleases(repo, tags, current, channel) {
  for (const tag of tags) {
    if (tag === current || !parseWebTag(tag, channel)) continue;
    // Only delete versioned Web tags, never legacy releases, installers or runtimes.
    const release = releaseForTag(repo, tag);
    if (release.tag_name !== tag || !Number.isInteger(release.id)) {
      throw new Error("WEB_RELEASE_DELETE_IDENTITY_MISMATCH");
    }
    runGh("api", "--method", "DELETE", `repos/${repo}/releases/${release.id}`);
    runGh("api", "--method", "DELETE", `repos/${repo}/git/refs/tags/${tag}`);
  }
}

function verifyPreviewRelease(repo, sha) {
  const previewTags = allChannelTags(repo, "preview");
  const latestPreview = latestWebTag(previewTags, "preview");
  if (!latestPreview || shaForTag(repo, latestPreview) !== sha) {
    throw new Error("WEB_PRODUCTION_EXACT_PREVIEW_RELEASE_REQUIRED");
  }
  const approved = releaseForTag(repo, latestPreview);
  if (approved.tag_name !== latestPreview || approved.draft !== false || approved.prerelease !== true) {
    throw new Error("WEB_PRODUCTION_INVALID_PREVIEW_RELEASE");
  }
  return latestPreview;
}

function publish({ repo, channel, sha, url, notesFile, allowCanonicalBootstrap = false }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !isExactSha(sha)) {
    throw new Error("WEB_RELEASE_INVALID_REPOSITORY_OR_SHA");
  }
  if (!CHANNELS[channel]) throw new Error("INVALID_WEB_RELEASE_CHANNEL");
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" || parsedUrl.origin !== url) {
    throw new Error("WEB_RELEASE_URL_NOT_HTTPS_ORIGIN");
  }
  if (channel === "production" && !allowCanonicalBootstrap) verifyPreviewRelease(repo, sha);
  const existing = allChannelTags(repo, channel);
  const latest = latestWebTag(existing, channel);
  if (latest && shaForTag(repo, latest) === sha) {
    if (releaseForTag(repo, latest).tag_name !== latest) {
      throw new Error("WEB_RELEASE_INCOMPLETE_CURRENT_TAG");
    }
    deletePriorWebReleases(repo, existing, latest, channel);
    process.stdout.write(`WEB_RELEASE_REUSED ${latest} ${sha}\n`);
    return latest;
  }

  const next = nextWebTag(existing, channel);
  const notes = notesFile
    ? readFileSync(notesFile, "utf8")
    : [
        `# ${next}`,
        "",
        `Channel: ${channel}`,
        `Source SHA: \`${sha}\``,
        `Validated deployment: ${url}`,
        "",
        "Web only; does not replace Companion/Qwen/Whisper releases.",
        "",
      ].join("\n");
  createGitHubRelease({ repo, tag: next, sha, channel, notes });
  deletePriorWebReleases(repo, existing, next, channel);
  process.stdout.write(`WEB_RELEASE_CREATED ${next} ${sha}\n`);
  return next;
}

async function bootstrapCurrentProduction(repo) {
  if (allChannelTags(repo, "production").length) {
    process.stdout.write("WEB_PRODUCTION_ALREADY_VERSIONED\n");
    return;
  }
  const response = await fetch("https://dnd.faysk.dev/api/version", {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(12000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("WEB_BOOTSTRAP_CANONICAL_HEALTH_UNAVAILABLE");
  const current = await response.json();
  const sha = current.commit;
  if (!isExactSha(sha) || current.environment !== "production") {
    throw new Error("WEB_BOOTSTRAP_INVALID_PRODUCTION_IDENTITY");
  }
  const legacy = `prod-${sha.slice(0, 12)}`;
  if (shaForTag(repo, legacy) !== sha || releaseForTag(repo, legacy).tag_name !== legacy) {
    throw new Error("WEB_BOOTSTRAP_LEGACY_RECEIPT_MISMATCH");
  }
  publish({
    repo,
    channel: "production",
    sha,
    url: "https://dnd.faysk.dev",
    allowCanonicalBootstrap: true, // Canonical URL and matching legacy production receipt already verified.
  });
}

async function main() {
  const command = process.argv[2];
  const repo = process.env.GITHUB_REPOSITORY;
  if (command === "verify-preview") {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "") ||
        !isExactSha(process.env.SOURCE_SHA)) {
      throw new Error("WEB_RELEASE_INVALID_REPOSITORY_OR_SHA");
    }
    process.stdout.write(`WEB_PREVIEW_RELEASE_VERIFIED ${verifyPreviewRelease(repo, process.env.SOURCE_SHA)}\n`);
    return;
  }
  if (command === "bootstrap-production") {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "")) {
      throw new Error("WEB_RELEASE_INVALID_REPOSITORY");
    }
    await bootstrapCurrentProduction(repo);
    return;
  }
  if (!CHANNELS[command]) throw new Error("Usage: node tools/ci/web-release.mjs preview|production|bootstrap-production");
  publish({
    repo,
    channel: command,
    sha: process.env.SOURCE_SHA,
    url: process.env.DEPLOYMENT_URL,
    notesFile: process.env.RELEASE_NOTES_FILE,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
