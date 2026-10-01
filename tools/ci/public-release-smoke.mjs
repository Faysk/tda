import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REQUEST_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const UNAVAILABLE_MARKERS = new Map([
  ["/", [
    "Arquivo indisponível",
    "Não conseguimos abrir a última memória agora.",
    "Não foi possível carregar as memórias.",
  ]],
  ["/campanhas", [
    "Diretório temporariamente indisponível",
    "Não conseguimos carregar as campanhas agora.",
  ]],
  ["/sessoes", [
    "Não foi possível carregar as sessões.",
    "Estamos preparando o arquivo de campanhas.",
  ]],
  ["/campanhas/sessoes", [
    "Não foi possível carregar as sessões.",
    "Estamos preparando o arquivo de campanhas.",
  ]],
]);

const EMPTY_MARKERS = new Map([
  ["/campanhas", "Nenhuma campanha pública ainda"],
  ["/campanhas/sessoes", "Nenhuma sessão publicada ainda."],
]);

const SESSION_UNAVAILABLE_MARKERS = [
  "Esta sessão está temporariamente indisponível.",
  "Não foi possível carregar as sessões desta campanha agora.",
];

const SESSION_LINK_PATTERN =
  /href=["'](\/campanhas\/[a-z0-9]+(?:-[a-z0-9]+)*\/sessoes\/[^"'?#<>/]+)["']/giu;

export class PublicReleaseSmokeError extends Error {
  constructor(code, route) {
    super("public release smoke failed: " + code + " (" + route + ")");
    this.name = "PublicReleaseSmokeError";
    this.code = code;
    this.route = route;
  }
}

function normalizeBody(body) {
  return String(body ?? "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&quot;/giu, '"')
    .replace(/&amp;/giu, "&")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function containsMarker(body, markers) {
  const normalized = normalizeBody(body).toLocaleLowerCase("pt-PT");
  return markers.some((marker) =>
    normalized.includes(marker.toLocaleLowerCase("pt-PT")),
  );
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("base URL must use https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("base URL must not contain credentials, query or fragment");
  }
  url.pathname = "/";
  return url;
}

function normalizeSha(value) {
  const sha = String(value ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/u.test(sha)) {
    throw new Error("source SHA must be a full 40-character hexadecimal commit");
  }
  return sha;
}

function nowIso(nowImpl) {
  const value = nowImpl();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid smoke timestamp");
  return date.toISOString();
}

function record(logger, { sourceSha, phase, route, result, at, code, state }) {
  const payload = {
    schema: "tda.public-release-smoke.v1",
    sha: sourceSha,
    phase,
    route,
    result,
    at,
  };
  if (code) payload.code = code;
  if (state) payload.state = state;
  logger(JSON.stringify(payload));
}

function fail(context, code, route) {
  record(context.logger, {
    sourceSha: context.sourceSha,
    phase: context.phase,
    route,
    result: "fail",
    at: nowIso(context.nowImpl),
    code,
  });
  throw new PublicReleaseSmokeError(code, route);
}

function expectedFinalPath(route) {
  return route === "/sessoes" ? "/campanhas/sessoes" : route;
}

function validateTransportResult(context, route, response) {
  if (!response || !Number.isInteger(response.status)) {
    fail(context, "invalid_transport_result", route);
  }
  if (response.status < 200 || response.status >= 300) {
    fail(context, "http_status", route);
  }

  let finalUrl;
  try {
    finalUrl = new URL(response.finalUrl);
  } catch {
    fail(context, "missing_final_url", route);
  }

  if (
    finalUrl.protocol !== "https:" ||
    finalUrl.host !== context.base.host ||
    finalUrl.pathname !== expectedFinalPath(route)
  ) {
    fail(context, "redirect_destination", route);
  }

  const unavailable = UNAVAILABLE_MARKERS.get(route) ?? [];
  if (containsMarker(response.body, unavailable)) {
    fail(context, "unavailable_content", route);
  }

  record(context.logger, {
    sourceSha: context.sourceSha,
    phase: context.phase,
    route,
    result: "pass",
    at: nowIso(context.nowImpl),
  });

  return response.body;
}

function extractPublicSessionPath(body) {
  SESSION_LINK_PATTERN.lastIndex = 0;
  const match = SESSION_LINK_PATTERN.exec(String(body ?? ""));
  return match?.[1] ?? null;
}

function assertCanonicalRegistry(context, body) {
  if (String(body ?? "").includes('data-campaign-registry="canonical"')) return;
  fail(context, "registry_incompatible", "/campanhas");
}

function assertSessionContent(context, route, body) {
  if (containsMarker(body, SESSION_UNAVAILABLE_MARKERS)) {
    fail(context, "unavailable_content", route);
  }
  if (
    !String(body ?? "").includes("data-session-reader-hero") ||
    !String(body ?? "").includes("data-session-reading")
  ) {
    fail(context, "unexpected_session_content", route);
  }
}

export async function requestWithFetch({ baseUrl, route, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(new URL(route, baseUrl), {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "tda-public-release-smoke/1",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    throw new Error("response body exceeds smoke limit");
  }
  return {
    status: response.status,
    finalUrl: response.url,
    body,
  };
}

export async function requestWithVercel({ baseUrl, route }) {
  const directory = await mkdtemp(path.join(tmpdir(), "tda-release-smoke-"));
  const bodyPath = path.join(directory, "body.html");
  try {
    const args = [
      "curl",
      route,
      "--deployment",
      baseUrl.origin,
      "--silent",
      "--show-error",
      "--location",
      "--output",
      bodyPath,
      "--write-out",
      "%{http_code}\\n%{url_effective}",
    ];
    let stdout;
    try {
      ({ stdout } = await execFileAsync("vercel", args, {
        env: process.env,
        maxBuffer: 1024 * 1024,
      }));
    } catch {
      throw new Error("vercel transport failed");
    }

    const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
    const finalUrl = lines.at(-1);
    const status = Number.parseInt(lines.at(-2) ?? "", 10);
    if (!Number.isInteger(status) || !finalUrl) {
      throw new Error("vercel transport returned invalid metadata");
    }
    const body = await readFile(bodyPath, "utf8");
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      throw new Error("response body exceeds smoke limit");
    }
    return { status, finalUrl, body };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runPublicReleaseSmoke({
  baseUrl,
  sourceSha,
  phase,
  requestImpl = requestWithFetch,
  logger = console.log,
  nowImpl = () => new Date(),
}) {
  if (!["staged", "canonical"].includes(phase)) {
    throw new Error("phase must be staged or canonical");
  }
  if (typeof requestImpl !== "function") {
    throw new Error("request implementation is required");
  }
  const base = normalizeBaseUrl(baseUrl);
  const sha = normalizeSha(sourceSha);
  const context = { base, sourceSha: sha, phase, logger, nowImpl };

  const request = async (route) => {
    let response;
    try {
      response = await requestImpl({ baseUrl: base, route });
    } catch {
      fail(context, "transport_error", route);
    }
    return validateTransportResult(context, route, response);
  };

  await request("/");
  const directoryBody = await request("/campanhas");
  assertCanonicalRegistry(context, directoryBody);

  const compatibilityBody = await request("/sessoes");
  const archiveBody = await request("/campanhas/sessoes");

  const directoryEmpty = containsMarker(
    directoryBody,
    [EMPTY_MARKERS.get("/campanhas")],
  );
  const archiveEmpty = containsMarker(
    archiveBody,
    [EMPTY_MARKERS.get("/campanhas/sessoes")],
  );
  const compatibilityEmpty = containsMarker(
    compatibilityBody,
    [EMPTY_MARKERS.get("/campanhas/sessoes")],
  );

  if (archiveEmpty !== compatibilityEmpty) {
    fail(context, "compatibility_content_mismatch", "/sessoes");
  }

  const sessionPath = extractPublicSessionPath(archiveBody);
  if (!sessionPath) {
    if (!archiveEmpty) {
      fail(context, "missing_public_session_link", "/campanhas/sessoes");
    }
    record(logger, {
      sourceSha: sha,
      phase,
      route: "/campanhas/sessoes",
      result: "pass",
      at: nowIso(nowImpl),
      state: "authorized_empty",
    });
    return {
      ok: true,
      phase,
      sourceSha: sha,
      empty: true,
      directoryEmpty,
      sessionPath: null,
    };
  }

  if (directoryEmpty) {
    fail(context, "directory_archive_inconsistent", "/campanhas");
  }

  const sessionBody = await request(sessionPath);
  assertSessionContent(context, sessionPath, sessionBody);
  record(logger, {
    sourceSha: sha,
    phase,
    route: sessionPath,
    result: "pass",
    at: nowIso(nowImpl),
    state: "public_session_content",
  });

  return {
    ok: true,
    phase,
    sourceSha: sha,
    empty: false,
    directoryEmpty: false,
    sessionPath,
  };
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("arguments must be provided as --key value pairs");
    }
    args.set(key, value);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = args.get("--base-url");
  const sourceSha = args.get("--source-sha");
  const phase = args.get("--phase");
  const transport = args.get("--transport") ?? "http";
  if (!baseUrl || !sourceSha || !phase) {
    throw new Error("--base-url, --source-sha and --phase are required");
  }
  if (!["http", "vercel"].includes(transport)) {
    throw new Error("--transport must be http or vercel");
  }

  await runPublicReleaseSmoke({
    baseUrl,
    sourceSha,
    phase,
    requestImpl: transport === "vercel" ? requestWithVercel : requestWithFetch,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const message =
      error instanceof PublicReleaseSmokeError
        ? error.message
        : "public release smoke failed before a route result could be recorded";
    console.error(message);
    process.exitCode = 1;
  });
}
