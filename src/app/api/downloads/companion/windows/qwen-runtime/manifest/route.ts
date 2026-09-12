import { createHash } from "node:crypto";
import {
	selectLatestQwenRuntimeTag,
	selectQwenRuntimeBundleManifestAssetInfo,
	selectQwenRuntimePartAssetInfo,
} from "@/features/edit/processing/companion-release";
import { parseQwenRuntimeBundle } from "@/features/edit/processing/qwen-runtime-bundle";

const TAGS_URL =
	"https://api.github.com/repos/Faysk/tda/git/matching-refs/tags/companion-qwen-runtime-v";
const RELEASE_BY_TAG_URL = "https://api.github.com/repos/Faysk/tda/releases/tags/";
const GITHUB_HEADERS = {
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
};
const MAX_MANIFEST_BYTES = 256 * 1024;

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

export async function GET() {
	try {
		const tagsResponse = await fetch(TAGS_URL, {
			headers: GITHUB_HEADERS,
			next: { revalidate: 300 },
		});
		if (!tagsResponse.ok) {
			return Response.json(
				{ error: "QWEN_RUNTIME_RELEASE_LOOKUP_FAILED" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}
		const tag = selectLatestQwenRuntimeTag(await tagsResponse.json());
		if (!tag) {
			return Response.json(
				{ error: "QWEN_RUNTIME_RELEASE_NOT_FOUND" },
				{ status: 404, headers: { "Cache-Control": "no-store" } },
			);
		}

		const releaseResponse = await fetch(`${RELEASE_BY_TAG_URL}${encodeURIComponent(tag)}`, {
			headers: GITHUB_HEADERS,
			next: { revalidate: 300 },
		});
		if (!releaseResponse.ok) {
			return Response.json(
				{ error: "QWEN_RUNTIME_RELEASE_LOOKUP_FAILED" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}
		const release = await releaseResponse.json();
		const manifestAsset = selectQwenRuntimeBundleManifestAssetInfo(release, tag);
		if (!manifestAsset || manifestAsset.size > MAX_MANIFEST_BYTES) {
			return Response.json(
				{ error: "QWEN_RUNTIME_RELEASE_INVALID" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}

		const assetResponse = await fetch(manifestAsset.url, {
			headers: { Accept: "application/json" },
			cache: "no-store",
			redirect: "follow",
		});
		if (!assetResponse.ok) {
			return Response.json(
				{ error: "QWEN_RUNTIME_BUNDLE_LOOKUP_FAILED" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}
		const body = new Uint8Array(await assetResponse.arrayBuffer());
		if (
			body.byteLength !== manifestAsset.size ||
			body.byteLength > MAX_MANIFEST_BYTES ||
			sha256(body) !== manifestAsset.sha256
		) {
			return Response.json(
				{ error: "QWEN_RUNTIME_BUNDLE_INVALID" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}
		let raw: unknown;
		try {
			raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
		} catch {
			return Response.json(
				{ error: "QWEN_RUNTIME_BUNDLE_INVALID" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}
		const bundle = parseQwenRuntimeBundle(raw, manifestAsset.version);
		if (!bundle) {
			return Response.json(
				{ error: "QWEN_RUNTIME_BUNDLE_INVALID" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}
		for (const part of bundle.parts) {
			const asset = selectQwenRuntimePartAssetInfo(release, tag, part.name);
			if (!asset || asset.size !== part.size || asset.sha256 !== part.sha256) {
				return Response.json(
					{ error: "QWEN_RUNTIME_RELEASE_PART_MISMATCH" },
					{ status: 503, headers: { "Cache-Control": "no-store" } },
				);
			}
		}

		return Response.json(
			{
				channel: "stable",
				runtime_id: "qwen3-transformers",
				version: manifestAsset.version,
				tag,
				bundle,
			},
			{
				headers: {
					"Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
					"X-Content-Type-Options": "nosniff",
				},
			},
		);
	} catch {
		return Response.json(
			{ error: "QWEN_RUNTIME_RELEASE_LOOKUP_FAILED" },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
}
