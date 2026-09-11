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
	if (!match || !Array.isArray(release.assets)) return null;

	const asset = release.assets.find((entry) => {
		if (!entry || typeof entry !== "object") return false;
		return (entry as ReleaseAsset).name === ASSET_NAME;
	}) as ReleaseAsset | undefined;
	if (!asset || typeof asset.browser_download_url !== "string") return null;

	const expectedPrefix = `${DOWNLOAD_PREFIX}${release.tag_name}/`;
	if (asset.browser_download_url !== `${expectedPrefix}${ASSET_NAME}`) return null;

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

export function selectLatestCompanionAsset(releases: unknown): string | null {
	if (!Array.isArray(releases)) return null;
	let latest: Candidate | null = null;
	for (const release of releases) {
		const candidate = candidateFromRelease(release);
		if (candidate && (!latest || isNewer(candidate, latest))) latest = candidate;
	}
	return latest?.url ?? null;
}
