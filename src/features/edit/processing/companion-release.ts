const ASSET_NAME = "TDACompanion-x64.msi";
const TAG_PATTERN = /^companion-v(\d+)\.(\d+)\.(\d+)$/;
const REF_PATTERN = /^refs\/tags\/(companion-v(\d+)\.(\d+)\.(\d+))$/;
const DOWNLOAD_PREFIX = "https://github.com/Faysk/tda/releases/download/";

type GithubRef = {
	ref?: unknown;
};

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

type TagCandidate = {
	tag: string;
	version: readonly [number, number, number];
};

function isNewer(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): boolean {
	for (let index = 0; index < 3; index += 1) {
		if (left[index] !== right[index]) return left[index] > right[index];
	}
	return false;
}

export function selectLatestCompanionTag(refs: unknown): string | null {
	if (!Array.isArray(refs)) return null;
	let latest: TagCandidate | null = null;

	for (const value of refs) {
		if (!value || typeof value !== "object") continue;
		const ref = (value as GithubRef).ref;
		if (typeof ref !== "string") continue;
		const match = REF_PATTERN.exec(ref);
		if (!match) continue;

		const candidate: TagCandidate = {
			tag: match[1],
			version: [Number(match[2]), Number(match[3]), Number(match[4])],
		};
		if (!latest || isNewer(candidate.version, latest.version)) latest = candidate;
	}

	return latest?.tag ?? null;
}

export function selectCompanionAsset(
	value: unknown,
	expectedTag: string,
): string | null {
	if (!TAG_PATTERN.test(expectedTag) || !value || typeof value !== "object") return null;
	const release = value as GithubRelease;
	if (
		release.draft === true ||
		release.prerelease === true ||
		release.tag_name !== expectedTag ||
		!Array.isArray(release.assets)
	) {
		return null;
	}

	const asset = release.assets.find((entry) => {
		if (!entry || typeof entry !== "object") return false;
		return (entry as ReleaseAsset).name === ASSET_NAME;
	}) as ReleaseAsset | undefined;
	if (!asset || typeof asset.browser_download_url !== "string") return null;

	const expectedUrl = `${DOWNLOAD_PREFIX}${expectedTag}/${ASSET_NAME}`;
	return asset.browser_download_url === expectedUrl ? expectedUrl : null;
}
