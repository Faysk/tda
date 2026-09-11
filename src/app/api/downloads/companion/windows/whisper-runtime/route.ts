import {
	selectLatestWhisperRuntimeTag,
	selectWhisperRuntimeAsset,
} from "@/features/edit/processing/companion-release";

const TAGS_URL =
	"https://api.github.com/repos/Faysk/tda/git/matching-refs/tags/companion-whisper-runtime-v";
const RELEASE_BY_TAG_URL = "https://api.github.com/repos/Faysk/tda/releases/tags/";
const GITHUB_HEADERS = {
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
};

export async function GET() {
	try {
		const tagsResponse = await fetch(TAGS_URL, {
			headers: GITHUB_HEADERS,
			next: { revalidate: 300 },
		});
		if (!tagsResponse.ok) {
			return Response.json(
				{ error: "WHISPER_RUNTIME_RELEASE_LOOKUP_FAILED" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}
		const tag = selectLatestWhisperRuntimeTag(await tagsResponse.json());
		if (!tag) {
			return Response.json(
				{ error: "WHISPER_RUNTIME_RELEASE_NOT_FOUND" },
				{ status: 404, headers: { "Cache-Control": "no-store" } },
			);
		}
		const releaseResponse = await fetch(`${RELEASE_BY_TAG_URL}${encodeURIComponent(tag)}`, {
			headers: GITHUB_HEADERS,
			next: { revalidate: 300 },
		});
		if (!releaseResponse.ok) {
			return Response.json(
				{ error: "WHISPER_RUNTIME_RELEASE_LOOKUP_FAILED" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}
		const downloadUrl = selectWhisperRuntimeAsset(await releaseResponse.json(), tag);
		if (!downloadUrl) {
			return Response.json(
				{ error: "WHISPER_RUNTIME_RELEASE_INVALID" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}
		return new Response(null, {
			status: 307,
			headers: {
				Location: downloadUrl,
				"Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
			},
		});
	} catch {
		return Response.json(
			{ error: "WHISPER_RUNTIME_RELEASE_LOOKUP_FAILED" },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
}
