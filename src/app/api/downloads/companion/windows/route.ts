import { selectLatestCompanionAsset } from "@/features/edit/processing/companion-release";

const RELEASES_URL = "https://api.github.com/repos/Faysk/tda/releases?per_page=30";

export async function GET() {
	try {
		const response = await fetch(RELEASES_URL, {
			headers: {
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			next: { revalidate: 300 },
		});
		if (!response.ok) {
			return Response.json(
				{ error: "COMPANION_RELEASE_LOOKUP_FAILED" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}

		const downloadUrl = selectLatestCompanionAsset(await response.json());
		if (!downloadUrl) {
			return Response.json(
				{ error: "COMPANION_RELEASE_NOT_FOUND" },
				{ status: 404, headers: { "Cache-Control": "no-store" } },
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
			{ error: "COMPANION_RELEASE_LOOKUP_FAILED" },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
}
