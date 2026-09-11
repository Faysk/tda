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
	digest?: unknown;
	size?: unknown;
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

export type CompanionAssetInfo = {
	tag: string;
	version: string;
	url: string;
	sha256: string;
	size: number;
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

function releaseAsset(value: unknown, expectedTag: string): ReleaseAsset | null {
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
	return (
		(release.assets.find((entry) => {
			if (!entry || typeof entry !== "object") return false;
			return (entry as ReleaseAsset).name === ASSET_NAME;
		}) as ReleaseAsset | undefined) ?? null
	);
}

export function selectCompanionAsset(
	value: unknown,
	expectedTag: string,
): string | null {
	const asset = releaseAsset(value, expectedTag);
	if (!asset || typeof asset.browser_download_url !== "string") return null;
	const expectedUrl = `${DOWNLOAD_PREFIX}${expectedTag}/${ASSET_NAME}`;
	return asset.browser_download_url === expectedUrl ? expectedUrl : null;
}

export function selectCompanionAssetInfo(
	value: unknown,
	expectedTag: string,
): CompanionAssetInfo | null {
	const url = selectCompanionAsset(value, expectedTag);
	const asset = releaseAsset(value, expectedTag);
	const tagMatch = TAG_PATTERN.exec(expectedTag);
	if (!url || !asset || !tagMatch) return null;
	if (typeof asset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
		return null;
	}
	if (typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
		return null;
	}
	return {
		tag: expectedTag,
		version: `${tagMatch[1]}.${tagMatch[2]}.${tagMatch[3]}`,
		url,
		sha256: asset.digest.slice("sha256:".length),
		size: asset.size,
	};
}
