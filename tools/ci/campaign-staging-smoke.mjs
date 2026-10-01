import { pathToFileURL } from "node:url";

export const STAGING_SMOKE_PATHS = ["/api/health", "/", "/campanhas", "/campanhas/sessoes"];

export function normalizeStagingBaseUrl(value) {
	const url = new URL(value);
	if (url.protocol !== "https:") throw new Error("staging_base_url must use https");
	if (url.username || url.password || url.search || url.hash) throw new Error("staging_base_url must not contain credentials, query or fragment");
	url.pathname = "/";
	return url;
}

export async function runStagingSmoke({ baseUrl, phase, fetchImpl = fetch }) {
	if (!["pre_activation", "post_activation"].includes(phase)) throw new Error("invalid smoke phase");
	const base = normalizeStagingBaseUrl(baseUrl);
	const checks = [];
	for (const path of STAGING_SMOKE_PATHS) {
		const url = new URL(path, base);
		const response = await fetchImpl(url, {
			method: "GET",
			redirect: "follow",
			headers: { "user-agent": "tda-campaign-isolation-gate/1" },
			signal: AbortSignal.timeout(15000),
		});
		checks.push({ path, status: response.status, ok: response.ok });
		if (!response.ok) throw new Error(`staging smoke failed for ${path}: HTTP ${response.status}`);
	}
	return {
		schema: "tda.campaign-staging-smoke.v1",
		phase,
		origin: base.origin,
		publicOnly: true,
		containsCredentials: false,
		checks,
	};
}

async function main() {
	const args = new Map();
	for (let index = 2; index < process.argv.length; index += 2) {
		args.set(process.argv[index], process.argv[index + 1]);
	}
	const baseUrl = args.get("--base-url");
	const phase = args.get("--phase");
	if (!baseUrl || !phase) throw new Error("--base-url and --phase are required");
	const result = await runStagingSmoke({ baseUrl, phase });
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
