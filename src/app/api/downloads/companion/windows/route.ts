import { createHash } from "node:crypto";
import {
	type CompanionAssetInfo,
	isCompanionInstallableTag,
	selectCompanionInstallableAssetInfo,
	selectLatestCompanionTag,
} from "@/features/edit/processing/companion-release";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

const STABLE_REFS_URL =
	"https://api.github.com/repos/Faysk/tda/git/matching-refs/tags/companion-v";
const RELEASE_BY_TAG_URL = "https://api.github.com/repos/Faysk/tda/releases/tags/";
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const GITHUB_HEADERS = {
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
};
const NO_STORE_HEADERS = {
	"Cache-Control": "no-store, max-age=0",
	Pragma: "no-cache",
};

async function downloadAsset(asset: CompanionAssetInfo, request: Request) {
	const upstream = await fetch(asset.url, {
		cache: "no-store",
		signal: request.signal,
		headers: { Accept: "application/octet-stream" },
	});
	if (upstream.status !== 200 || !upstream.body) {
		throw new Error("COMPANION_ASSET_DOWNLOAD_FAILED");
	}
	const declaredLength = upstream.headers.get("content-length");
	if (declaredLength !== null && Number(declaredLength) !== asset.size) {
		await upstream.body.cancel();
		throw new Error("COMPANION_ASSET_SIZE_MISMATCH");
	}
	const reader = upstream.body.getReader();
	const digest = createHash("sha256");
	let received = 0;
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const chunk = await reader.read();
				if (chunk.done) {
					if (received !== asset.size || digest.digest("hex") !== asset.sha256) {
						throw new Error("COMPANION_ASSET_INTEGRITY_MISMATCH");
					}
					controller.close();
					return;
				}
				received += chunk.value.byteLength;
				if (received > asset.size) throw new Error("COMPANION_ASSET_SIZE_MISMATCH");
				digest.update(chunk.value);
				controller.enqueue(chunk.value);
			} catch (error) {
				controller.error(error);
				await reader.cancel().catch(() => {});
			}
		},
		cancel(reason) {
			return reader.cancel(reason);
		},
	});
	return new Response(stream, {
		headers: {
			...NO_STORE_HEADERS,
			"Content-Type": "application/octet-stream",
			"Content-Disposition": 'attachment; filename="TDACompanion-x64.msi"',
			"X-Content-Type-Options": "nosniff",
			"X-TDA-Asset-SHA256": asset.sha256,
		},
	});
}

async function latestStable() {
	const refsResponse = await fetch(STABLE_REFS_URL, {
		headers: GITHUB_HEADERS,
		cache: "no-store",
	});
	if (!refsResponse.ok) throw new Error("COMPANION_RELEASE_LOOKUP_FAILED");
	const tag = selectLatestCompanionTag(await refsResponse.json());
	if (!tag) return null;

	const releaseResponse = await fetch(
		`${RELEASE_BY_TAG_URL}${encodeURIComponent(tag)}`,
		{
			headers: GITHUB_HEADERS,
			cache: "no-store",
		},
	);
	if (releaseResponse.status === 404) return null;
	if (!releaseResponse.ok) throw new Error("COMPANION_RELEASE_LOOKUP_FAILED");
	const release = await releaseResponse.json();
	const selected = selectCompanionInstallableAssetInfo(release, tag);
	return selected?.channel === "stable" ? selected : null;
}

export async function GET(request: Request) {
	try {
		const requestUrl = new URL(request.url);
		const versions = requestUrl.searchParams.getAll("version");
		const tags = requestUrl.searchParams.getAll("tag");
		const unexpectedQuery = Array.from(requestUrl.searchParams.keys()).some(
			(key) => key !== "version" && key !== "tag" && key !== "_vercel_share",
		);
		if (
			versions.length > 1 ||
			tags.length > 1 ||
			(versions.length > 0 && tags.length > 0) ||
			unexpectedQuery
		) {
			return Response.json(
				{ error: "COMPANION_RELEASE_REQUEST_INVALID" },
				{ status: 400, headers: NO_STORE_HEADERS },
			);
		}

		const requestedVersion = versions[0] ?? null;
		const requestedTag = tags[0] ?? null;
		if (requestedVersion !== null && !VERSION_PATTERN.test(requestedVersion)) {
			return Response.json(
				{ error: "COMPANION_RELEASE_REQUEST_INVALID" },
				{ status: 400, headers: NO_STORE_HEADERS },
			);
		}
		if (requestedTag !== null && !isCompanionInstallableTag(requestedTag)) {
			return Response.json(
				{ error: "COMPANION_RELEASE_REQUEST_INVALID" },
				{ status: 400, headers: NO_STORE_HEADERS },
			);
		}

		if (!requestedVersion && !requestedTag) {
			const latest = await latestStable();
			if (!latest) {
				return Response.json(
					{ error: "COMPANION_RELEASE_NOT_FOUND" },
					{ status: 404, headers: NO_STORE_HEADERS },
				);
			}
			return await downloadAsset(latest, request);
		}

		const tag = requestedTag ?? `companion-v${requestedVersion}`;
		const releaseResponse = await fetch(`${RELEASE_BY_TAG_URL}${encodeURIComponent(tag)}`, {
			headers: GITHUB_HEADERS,
			cache: "no-store",
		});
		if (releaseResponse.status === 404) {
			return Response.json(
				{ error: "COMPANION_RELEASE_NOT_FOUND" },
				{ status: 404, headers: NO_STORE_HEADERS },
			);
		}
		if (!releaseResponse.ok) {
			return Response.json(
				{ error: "COMPANION_RELEASE_LOOKUP_FAILED" },
				{ status: 503, headers: NO_STORE_HEADERS },
			);
		}

		const asset = selectCompanionInstallableAssetInfo(await releaseResponse.json(), tag);
		if (!asset) {
			return Response.json(
				{ error: "COMPANION_RELEASE_INVALID" },
				{ status: 503, headers: NO_STORE_HEADERS },
			);
		}

		return await downloadAsset(asset, request);
	} catch {
		return Response.json(
			{ error: "COMPANION_RELEASE_LOOKUP_FAILED" },
			{ status: 503, headers: NO_STORE_HEADERS },
		);
	}
}
