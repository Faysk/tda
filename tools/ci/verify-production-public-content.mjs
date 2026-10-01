import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const STATE_PATTERN = /data-public-content-state=(["'])(ready|empty|dependency_unavailable)\1/u;
const CAMPAIGN_ARCHIVE_PATTERN =
	/href=(["'])(\/campanhas\/[a-z0-9]+(?:-[a-z0-9]+)*\/sessoes)\1/gu;
const PUBLIC_SESSION_PATTERN =
	/href=(["'])(\/campanhas\/[a-z0-9]+(?:-[a-z0-9]+)*\/sessoes\/[^"'/?#]+)\1/gu;
const VERCEL_META_MARKER = "__TDA_PUBLIC_SMOKE_META__";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function safeErrorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function assertSourceSha(sourceSha) {
	if (typeof sourceSha !== "string" || !/^[a-f0-9]{40}$/u.test(sourceSha)) {
		throw new Error("sourceSha must be a full 40-character git SHA");
	}
}

function parseContentState(html, route) {
	if (typeof html !== "string" || html.length === 0) {
		throw new Error(`${route} returned an empty HTML body`);
	}
	const match = html.match(STATE_PATTERN);
	if (!match?.[2]) {
		throw new Error(`${route} is missing data-public-content-state`);
	}
	return match[2];
}

export function inspectPublicContentHtml(html, { route, allowEmpty = false }) {
	const state = parseContentState(html, route);
	if (state === "dependency_unavailable") {
		throw new Error(`${route} reported dependency_unavailable`);
	}
	if (state === "empty" && !allowEmpty) {
		throw new Error(`${route} reported empty content where published content is required`);
	}
	return { state };
}

function firstHref(html, pattern) {
	pattern.lastIndex = 0;
	const match = pattern.exec(html);
	return match?.[2] ?? null;
}

export function extractCampaignArchivePath(html) {
	return firstHref(html, CAMPAIGN_ARCHIVE_PATTERN);
}

export function extractPublicSessionPath(html) {
	return firstHref(html, PUBLIC_SESSION_PATTERN);
}

function normalizedOrigin(value) {
	const url = new URL(value);
	return url.origin;
}

function defaultReporter(record) {
	const finalPart = record.finalPath ? ` final=${record.finalPath}` : "";
	const statusPart = Number.isInteger(record.status) ? ` status=${record.status}` : "";
	const reasonPart = record.reason ? ` reason=${record.reason}` : "";
	console.log(
		`PUBLIC_CONTENT_SMOKE sha=${record.sha} route=${record.route}${finalPart}${statusPart} result=${record.result} at=${record.at}${reasonPart}`,
	);
}

export async function verifyProductionPublicContent({
	sourceSha,
	expectedOrigin,
	requestPage,
	now = () => new Date(),
	onResult = defaultReporter,
}) {
	assertSourceSha(sourceSha);
	if (typeof requestPage !== "function") throw new Error("requestPage is required");
	const expectedOriginValue = normalizedOrigin(expectedOrigin);
	const records = [];

	function fail(route, reason) {
		const record = {
			sha: sourceSha,
			route,
			result: "FAIL",
			at: now().toISOString(),
			reason,
		};
		records.push(record);
		onResult(record);
		throw new Error(reason);
	}

	async function probe(route, { allowEmpty = false, expectedFinalPath = route } = {}) {
		const at = now().toISOString();
		let status;
		let finalPath;
		try {
			const response = await requestPage(route);
			status = response?.status;
			if (!Number.isInteger(status)) {
				throw new Error(`${route} returned no HTTP status`);
			}
			if (status < 200 || status >= 300) {
				throw new Error(`${route} returned HTTP ${status}`);
			}
			const finalUrl = new URL(response.url);
			finalPath = finalUrl.pathname;
			if (finalUrl.origin !== expectedOriginValue) {
				throw new Error(
					`${route} escaped expected origin: ${finalUrl.origin}`,
				);
			}
			if (finalUrl.pathname !== expectedFinalPath) {
				throw new Error(
					`${route} resolved to ${finalUrl.pathname}, expected ${expectedFinalPath}`,
				);
			}
			const inspected = inspectPublicContentHtml(response.body, {
				route: finalUrl.pathname,
				allowEmpty,
			});
			const record = {
				sha: sourceSha,
				route,
				finalPath: finalUrl.pathname,
				status: response.status,
				result: inspected.state,
				at,
			};
			records.push(record);
			onResult(record);
			return { ...response, finalUrl, state: inspected.state };
		} catch (error) {
			const record = {
				sha: sourceSha,
				route,
				...(finalPath ? { finalPath } : {}),
				...(Number.isInteger(status) ? { status } : {}),
				result: "FAIL",
				at,
				reason: safeErrorMessage(error),
			};
			records.push(record);
			onResult(record);
			throw error;
		}
	}

	const home = await probe("/", { allowEmpty: true });
	const directory = await probe("/campanhas", { allowEmpty: true });

	let campaignArchive = null;
	if (directory.state === "ready") {
		const campaignArchivePath = extractCampaignArchivePath(directory.body);
		if (!campaignArchivePath) {
			fail(
				"/campanhas",
				"/campanhas is ready but exposes no public campaign archive link",
			);
		}
		campaignArchive = await probe(campaignArchivePath, { allowEmpty: true });
	}

	const archive = await probe("/sessoes", {
		allowEmpty: true,
		expectedFinalPath: "/campanhas/sessoes",
	});

	if (directory.state === "empty" && archive.state === "ready") {
		fail(
			"/campanhas",
			"/campanhas is empty while the public session archive contains published sessions",
		);
	}
	if ((home.state === "ready") !== (archive.state === "ready")) {
		fail(
			"/",
			`Home/session archive semantic mismatch: home=${home.state} archive=${archive.state}`,
		);
	}

	if (archive.state === "ready") {
		const sessionPath =
			extractPublicSessionPath(archive.body) ??
			(campaignArchive?.state === "ready"
				? extractPublicSessionPath(campaignArchive.body)
				: null);
		if (!sessionPath) {
			fail(
				"/campanhas/sessoes",
				"/campanhas/sessoes is ready but exposes no public session detail link",
			);
		}
		await probe(sessionPath);
	}

	return records;
}

export function createHttpRequester(origin, {
	requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
	fetchImpl = globalThis.fetch,
} = {}) {
	const baseOrigin = normalizedOrigin(origin);
	if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
	return async (route) => {
		const response = await fetchImpl(new URL(route, `${baseOrigin}/`), {
			headers: { accept: "text/html" },
			cache: "no-store",
			redirect: "follow",
			signal: AbortSignal.timeout(requestTimeoutMs),
		});
		return {
			status: response.status,
			url: response.url,
			body: await response.text(),
		};
	};
}

async function runVercelCurl(args) {
	return execFileAsync("vercel", args, {
		maxBuffer: 8 * 1024 * 1024,
	});
}

export function createVercelRequester(deploymentUrl, {
	runCommand = runVercelCurl,
} = {}) {
	const deploymentOrigin = normalizedOrigin(deploymentUrl);
	return async (route) => {
		const args = [
			"curl",
			route,
			"--deployment",
			deploymentOrigin,
			"--silent",
			"--show-error",
			"--location",
			"--write-out",
			`\\n${VERCEL_META_MARKER}%{http_code}\\t%{url_effective}`,
		];
		let stdout;
		try {
			({ stdout } = await runCommand(args));
		} catch (error) {
			const code =
				error && typeof error === "object" && "code" in error
					? String(error.code)
					: "unknown";
			throw new Error(`vercel curl failed for ${route} (exit=${code})`);
		}
		const markerIndex = stdout.lastIndexOf(`\n${VERCEL_META_MARKER}`);
		if (markerIndex < 0) {
			throw new Error(`vercel curl returned no metadata for ${route}`);
		}
		const body = stdout.slice(0, markerIndex);
		const metadata = stdout
			.slice(markerIndex + VERCEL_META_MARKER.length + 1)
			.trim();
		const [statusText, effectiveUrl] = metadata.split("\t");
		const status = Number.parseInt(statusText ?? "", 10);
		if (!Number.isInteger(status) || !effectiveUrl) {
			throw new Error(`vercel curl returned invalid metadata for ${route}`);
		}
		return { status, url: effectiveUrl, body };
	};
}

function parseCliArgs(argv) {
	const result = {};
	for (let index = 0; index < argv.length; index += 1) {
		const key = argv[index];
		if (!key?.startsWith("--")) throw new Error(`Unknown argument: ${key}`);
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
		result[key.slice(2)] = value;
		index += 1;
	}
	return result;
}

export function resolveCliTarget(args, env = process.env) {
	const deployment = args.deployment;
	const explicitOrigin = args.origin;
	if (deployment && explicitOrigin) {
		throw new Error("Provide only one of --deployment or --origin");
	}
	const origin = explicitOrigin ?? (deployment ? undefined : env.PRODUCTION_ORIGIN);
	if (!deployment && !origin) {
		throw new Error("Provide --deployment or --origin/PRODUCTION_ORIGIN");
	}
	return deployment
		? { kind: "staged", value: deployment }
		: { kind: "canonical", value: origin };
}

async function main() {
	const args = parseCliArgs(process.argv.slice(2));
	const sourceSha = args.sha ?? process.env.SOURCE_SHA;
	const target = resolveCliTarget(args);
	const expectedOrigin = target.value;
	const requestPage =
		target.kind === "staged"
			? createVercelRequester(target.value)
			: createHttpRequester(target.value);
	const records = await verifyProductionPublicContent({
		sourceSha,
		expectedOrigin,
		requestPage,
	});
	console.log(
		JSON.stringify({
			ok: true,
			sha: sourceSha,
			target: target.kind,
			routes: records.map(({ route, finalPath, status, result, at }) => ({
				route,
				finalPath,
				status,
				result,
				at,
			})),
		}),
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error) => {
		console.error(safeErrorMessage(error));
		process.exitCode = 1;
	});
}
