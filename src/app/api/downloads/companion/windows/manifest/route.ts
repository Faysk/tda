import {
	selectCompanionAssetInfo,
	selectLatestCompanionTag,
} from "@/features/edit/processing/companion-release";

const TAGS_URL =
	"https://api.github.com/repos/Faysk/tda/git/matching-refs/tags/companion-v";
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
				{ error: "COMPANION_RELEASE_LOOKUP_FAILED" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}

		const tag = selectLatestCompanionTag(await tagsResponse.json());
		if (!tag) {
			return Response.json(
				{ error: "COMPANION_RELEASE_NOT_FOUND" },
				{ status: 404, headers: { "Cache-Control": "no-store" } },
			);
		}

		const releaseResponse = await fetch(`${RELEASE_BY_TAG_URL}${encodeURIComponent(tag)}`, {
			headers: GITHUB_HEADERS,
			next: { revalidate: 300 },
		});
		if (!releaseResponse.ok) {
			return Response.json(
				{ error: "COMPANION_RELEASE_LOOKUP_FAILED" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}

		const asset = selectCompanionAssetInfo(await releaseResponse.json(), tag);
		if (!asset) {
			return Response.json(
				{ error: "COMPANION_RELEASE_INVALID" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}

		return Response.json(
			{
				channel: "stable",
				version: asset.version,
				tag: asset.tag,
				minimum_api: "1",
				asset: {
					url: "/api/downloads/companion/windows",
					sha256: asset.sha256,
					size: asset.size,
				},
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
			{ error: "COMPANION_RELEASE_LOOKUP_FAILED" },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
}
