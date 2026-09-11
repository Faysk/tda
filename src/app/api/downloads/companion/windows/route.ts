const RELEASES_URL = "https://api.github.com/repos/Faysk/tda/releases?per_page=30";
const ASSET_NAME = "TDACompanion-x64.msi";
const TAG_PATTERN = /^companion-v(\d+)\.(\d+)\.(\d+)$/;
const DOWNLOAD_PREFIX = "https://github.com/Faysk/tda/releases/download/";

type ReleaseAsset = {
	name?: unknown;
	browser_download_url?: unknown;
};

type GithubRelease = {
	tag_name?: unknown;
	draft?: unknown;
	prerelease?: unknown;
	assets?: unknown;
};

type Candidate = {
	version: readonly [number, number, number];
	url: string;
};

function candidateFromRelease(value: unknown): Candidate | null {
	if (!value || typeof value !== "object") return null;
	const release = value as GithubRelease;
	if (release.draft === true || release.prerelease === true) return null;
	if (typeof release.tag_name !== "string") return null;

	const match = TAG_PATTERN.exec(release.tag_name);
	if (!match) return null;
	if (!Array.isArray(release.assets)) return null;

	const asset = release.assets.find((entry) => {
		if (!entry || typeof entry !== "object") return false;
		return (entry as ReleaseAsset).name === ASSET_NAME;
	}) as ReleaseAsset | undefined;
	if (!asset || typeof asset.browser_download_url !== "string") return null;

	const expectedPrefix = `${DOWNLOAD_PREFIX}${release.tag_name}/`;
	if (!asset.browser_download_url.startsWith(expectedPrefix)) return null;

	return {
		version: [Number(match[1]), Number(match[2]), Number(match[3])],
		url: asset.browser_download_url,
	};
}

function isNewer(left: Candidate, right: Candidate): boolean {
	for (let index = 0; index < 3; index += 1) {
		if (left.version[index] !== right.version[index]) {
			return left.version[index] > right.version[index];
		}
	}
	return false;
}

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

		const releases: unknown = await response.json();
		if (!Array.isArray(releases)) {
			return Response.json(
				{ error: "COMPANION_RELEASE_RESPONSE_INVALID" },
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}

		let latest: Candidate | null = null;
		for (const release of releases) {
			const candidate = candidateFromRelease(release);
			if (candidate && (!latest || isNewer(candidate, latest))) latest = candidate;
		}

		if (!latest) {
			return Response.json(
				{ error: "COMPANION_RELEASE_NOT_FOUND" },
				{ status: 404, headers: { "Cache-Control": "no-store" } },
			);
		}

		return new Response(null, {
			status: 307,
			headers: {
				Location: latest.url,
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
