import { selectQwenRuntimePartAssetInfo } from "@/features/edit/processing/companion-release";

const RELEASE_BY_TAG_URL = "https://api.github.com/repos/Faysk/tda/releases/tags/";
const GITHUB_HEADERS = {
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
};
const PART = /^TDAQwenRuntime-(\d+\.\d+\.\d+)-windows-x64\.zip\.part(\d{3})$/;

export async function GET(
	_request: Request,
	context: { params: Promise<{ asset: string }> },
) {
	try {
		const { asset } = await context.params;
		const match = PART.exec(asset);
		if (!match || Number(match[2]) < 1 || Number(match[2]) > 16) {
			return Response.json(
				{ error: "QWEN_RUNTIME_ASSET_INVALID" },
				{ status: 404, headers: { "Cache-Control": "no-store" } },
			);
		}
		const tag = `companion-qwen-runtime-v${match[1]}`;
		const releaseResponse = await fetch(`${RELEASE_BY_TAG_URL}${encodeURIComponent(tag)}`, {
			headers: GITHUB_HEADERS,
			next: { revalidate: 300 },
		});
		if (!releaseResponse.ok) {
			return Response.json(
				{ error: "QWEN_RUNTIME_RELEASE_NOT_FOUND" },
				{ status: 404, headers: { "Cache-Control": "no-store" } },
			);
		}
		const info = selectQwenRuntimePartAssetInfo(await releaseResponse.json(), tag, asset);
		if (!info) {
			return Response.json(
				{ error: "QWEN_RUNTIME_RELEASE_INVALID" },
				{ status: 404, headers: { "Cache-Control": "no-store" } },
			);
		}
		return new Response(null, {
			status: 307,
			headers: {
				Location: info.url,
				"Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch {
		return Response.json(
			{ error: "QWEN_RUNTIME_RELEASE_LOOKUP_FAILED" },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
}
