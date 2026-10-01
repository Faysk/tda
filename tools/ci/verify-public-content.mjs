import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function assertPublicContent(html, path) {
	const state = html.match(/data-public-content-state="([a-z]+)"/u)?.[1];
	if (state !== "ready" && state !== "empty")
		throw new Error(`Public content unavailable or unverified: ${path}`);
	return state;
}

export async function verifyPublicContent(readPage) {
	const receipt = [];
	let detail;
	for (const path of ["/", "/campanhas", "/campanhas/sessoes", "/sessoes"]) {
		const page = await readPage(path);
		if (page.status !== 200) throw new Error(`Public HTTP ${page.status}: ${path}`);
		if (path === "/sessoes" && new URL(page.url).pathname !== "/campanhas/sessoes")
			throw new Error("Legacy archive did not reach the canonical archive");
		const state = assertPublicContent(page.html, path);
		receipt.push({ path, state });
		if (path === "/") {
			detail = page.html.match(/href="(\/campanhas\/[a-z0-9-]+\/sessoes\/[^"?#<>]+)"/u)?.[1];
			if (state === "ready" && !detail) throw new Error("Ready Home has no published session link");
		}
	}
	if (detail) {
		const page = await readPage(detail);
		if (page.status !== 200 || assertPublicContent(page.html, detail) !== "ready")
			throw new Error("Published session link does not render a ready detail");
		receipt.push({ path: detail, state: "ready" });
	}
	return { schema: "tda.public-content-smoke.v1", ok: true, pages: receipt };
}

async function main() {
	const deployment = process.argv[2] === "--deployment" ? process.argv[3] : undefined;
	const origin = process.env.PRODUCTION_ORIGIN;
	if (!deployment && !origin) throw new Error("Set PRODUCTION_ORIGIN or --deployment URL");
	const receipt = await verifyPublicContent(async (path) => {
		if (deployment) {
			const output = execFileSync("vercel", ["curl", path, "--deployment", deployment,
				"--fail", "--location", "--silent", "--show-error", "--max-time", "30",
				"--write-out", "\nTDA_SMOKE_STATUS=%{http_code}\nTDA_SMOKE_URL=%{url_effective}"],
				{ encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 45000 });
			const split = output.lastIndexOf("\nTDA_SMOKE_STATUS=");
			if (split < 0) throw new Error("Staged smoke omitted HTTP receipt");
			return { html: output.slice(0, split), status: Number(output.slice(split).match(/STATUS=(\d+)/u)?.[1]),
				url: output.slice(split).match(/TDA_SMOKE_URL=(.+)/u)?.[1] };
		}
		const response = await fetch(new URL(path, origin), { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(30000) });
		return { html: await response.text(), status: response.status, url: response.url };
	});
	console.log(JSON.stringify(receipt, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
