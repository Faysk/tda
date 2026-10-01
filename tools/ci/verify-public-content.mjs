import { spawnSync } from "node:child_process";

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const STATE_PATTERN = /data-public-content-state=["'](available|empty|unavailable)["']/i;
const SESSION_LINK_PATTERN =
	/href=["'](\/campanhas\/[a-z0-9-]+\/sessoes\/[^"'?#\s]+)(?:[?#][^"']*)?["']/giu;
const SESSION_CONTENT_PATTERN = /data-session-reading(?:=|[ >])/iu;
const VERCEL_META = "__TDA_HTTP_META__";

function utcNow() {
	return new Date().toISOString();
}

function normalizePath(url) {
	try {
		return new URL(url).pathname;
	} catch {
		return url.split(/[?#]/u, 1)[0] || "/";
	}
}

function normalizeOrigin(url) {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.origin
			: null;
	} catch {
		return null;
	}
}

function assertHttpSuccess(response, route) {
	if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
		throw new Error(`Public content route ${route} returned HTTP ${response.status ?? "<missing>"}`);
	}
}

function assertFinalDestination(response, route, expectedOrigin, expectedPath = route) {
	const finalPath = normalizePath(response.finalUrl);
	const finalOrigin = normalizeOrigin(response.finalUrl);
	if (finalOrigin !== expectedOrigin) {
		throw new Error(
			`Public content route ${route} resolved to unexpected origin ${finalOrigin ?? "<invalid>"}; expected ${expectedOrigin}`,
		);
	}
	if (finalPath !== expectedPath) {
		throw new Error(
			`Public content route ${route} resolved to unexpected destination ${finalPath}; expected ${expectedPath}`,
		);
	}
}

export function readPublicContentState(html) {
	const match = html.match(STATE_PATTERN);
	return match?.[1]?.toLowerCase() ?? null;
}

export function findPublicSessionPath(html) {
	SESSION_LINK_PATTERN.lastIndex = 0;
	const match = SESSION_LINK_PATTERN.exec(html);
	return match?.[1] ?? null;
}

export async function verifyPublicContent({
	sourceSha,
	expectedOrigin,
	request,
	now = utcNow,
	log = console.log,
}) {
	if (!sourceSha) throw new Error("sourceSha is required");
	if (typeof request !== "function") throw new Error("request implementation is required");
	const normalizedExpectedOrigin = normalizeOrigin(expectedOrigin);
	if (!normalizedExpectedOrigin) throw new Error("expectedOrigin must be an absolute HTTP(S) origin");

	const timestamp = now();
	const checks = [];
	const routes = [
		{ route: "/", expectedPath: "/" },
		{ route: "/campanhas", expectedPath: "/campanhas" },
		{ route: "/campanhas/sessoes", expectedPath: "/campanhas/sessoes" },
		{ route: "/sessoes", expectedPath: "/campanhas/sessoes" },
	];

	let archive = null;

	for (const spec of routes) {
		try {
			const response = await request(spec.route);
			assertHttpSuccess(response, spec.route);
			assertFinalDestination(
				response,
				spec.route,
				normalizedExpectedOrigin,
				spec.expectedPath,
			);

			const state = readPublicContentState(response.body);
			if (!state) {
				throw new Error(`Public content route ${spec.route} is missing its semantic state marker`);
			}
			if (state === "unavailable") {
				throw new Error(`Public content route ${spec.route} rendered dependency-unavailable content`);
			}

			const result = {
				route: spec.route,
				finalPath: normalizePath(response.finalUrl),
				state,
				status: response.status,
			};
			checks.push(result);
			log(
				`PUBLIC_CONTENT_SMOKE sha=${sourceSha} route=${spec.route} final=${result.finalPath} state=${state} result=PASS at=${timestamp}`,
			);

			if (spec.route === "/campanhas/sessoes") {
				archive = { ...result, body: response.body };
			}
		} catch (error) {
			log(
				`PUBLIC_CONTENT_SMOKE sha=${sourceSha} route=${spec.route} result=FAIL at=${timestamp}`,
			);
			throw error;
		}
	}

	if (!archive) throw new Error("Campaign session archive was not checked");

	if (archive.state === "available") {
		const sessionPath = findPublicSessionPath(archive.body);
		if (!sessionPath) {
			log(
				`PUBLIC_CONTENT_SMOKE sha=${sourceSha} route=/campanhas/sessoes result=FAIL at=${timestamp}`,
			);
			throw new Error("Published session archive is available but exposes no public session link");
		}

		try {
			const response = await request(sessionPath);
			assertHttpSuccess(response, sessionPath);
			assertFinalDestination(
				response,
				sessionPath,
				normalizedExpectedOrigin,
				sessionPath,
			);
			const state = readPublicContentState(response.body);
			if (state !== "available") {
				throw new Error(
					`Public session ${sessionPath} did not render available content (state=${state ?? "<missing>"})`,
				);
			}
			if (!SESSION_CONTENT_PATTERN.test(response.body)) {
				throw new Error(
					`Public session ${sessionPath} is missing the expected session-reading content marker`,
				);
			}

			const result = {
				route: sessionPath,
				finalPath: normalizePath(response.finalUrl),
				state,
				status: response.status,
			};
			checks.push(result);
			log(
				`PUBLIC_CONTENT_SMOKE sha=${sourceSha} route=${sessionPath} final=${result.finalPath} state=available result=PASS at=${timestamp}`,
			);
		} catch (error) {
			log(
				`PUBLIC_CONTENT_SMOKE sha=${sourceSha} route=${sessionPath} result=FAIL at=${timestamp}`,
			);
			throw error;
		}
	}

	return { ok: true, sourceSha, timestamp, checks };
}

export function createFetchRequest({
	origin,
	fetchImpl = globalThis.fetch,
	requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}) {
	if (!origin) throw new Error("origin is required");
	if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");

	const base = origin.replace(/\/$/u, "");
	return async (route) => {
		const response = await fetchImpl(`${base}${route}`, {
			headers: { accept: "text/html" },
			cache: "no-store",
			redirect: "follow",
			signal: AbortSignal.timeout(requestTimeoutMs),
		});
		return {
			status: response.status,
			finalUrl: response.url || `${base}${route}`,
			body: await response.text(),
		};
	};
}

export function createVercelRequest({
	deploymentUrl,
	requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}) {
	if (!deploymentUrl) throw new Error("deploymentUrl is required");

	return async (route) => {
		const command = spawnSync(
			"vercel",
			[
				"curl",
				route,
				"--deployment",
				deploymentUrl,
				"--location",
				"--silent",
				"--show-error",
				"--write-out",
				`\\n${VERCEL_META}%{http_code}\\t%{url_effective}`,
			],
			{
				encoding: "utf8",
				env: process.env,
				maxBuffer: 10 * 1024 * 1024,
				timeout: requestTimeoutMs,
			},
		);

		if (command.error || command.status !== 0) {
			throw new Error(`Vercel staged request failed for ${route}`);
		}

		const output = command.stdout ?? "";
		const markerIndex = output.lastIndexOf(`\n${VERCEL_META}`);
		if (markerIndex < 0) {
			throw new Error(`Vercel staged request for ${route} returned no HTTP metadata`);
		}

		const body = output.slice(0, markerIndex);
		const metadata = output.slice(markerIndex + 1 + VERCEL_META.length).trim();
		const [statusText, finalUrl] = metadata.split("\t", 2);
		const status = Number.parseInt(statusText ?? "", 10);
		if (!Number.isInteger(status) || !finalUrl) {
			throw new Error(`Vercel staged request for ${route} returned invalid HTTP metadata`);
		}

		return { status, finalUrl, body };
	};
}

async function main() {
	const sourceSha = process.env.SOURCE_SHA;
	const transport = process.env.PUBLIC_CONTENT_TRANSPORT ?? "fetch";
	const targetOrigin =
		transport === "vercel"
			? process.env.DEPLOYMENT_URL
			: process.env.PRODUCTION_ORIGIN;
	const expectedOrigin = normalizeOrigin(targetOrigin);
	if (!expectedOrigin) throw new Error("Public content target origin is missing or invalid");
	const request =
		transport === "vercel"
			? createVercelRequest({ deploymentUrl: targetOrigin })
			: createFetchRequest({ origin: targetOrigin });

	const result = await verifyPublicContent({ sourceSha, expectedOrigin, request });
	console.log(
		JSON.stringify({
			ok: result.ok,
			sha: result.sourceSha,
			timestamp: result.timestamp,
			routes: result.checks.map(({ route, finalPath, state, status }) => ({
				route,
				finalPath,
				state,
				status,
			})),
		}),
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
