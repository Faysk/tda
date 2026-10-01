import pipipiManifest from "../../../media/manifests/pipipi.json";

type PipipiManifestAsset = (typeof pipipiManifest.assets)[number];

function buildPipipiAssetUrl(asset: PipipiManifestAsset) {
	const origin = pipipiManifest.publicOrigin.replace(/\/$/, "");
	const namespace = pipipiManifest.namespace.replace(/^\/+|\/+$/g, "");
	return `${origin}/${namespace}/${asset.sha256}/${asset.file}`;
}

const pipipiAssetUrls = new Map(
	pipipiManifest.assets.map((asset) => [asset.file, buildPipipiAssetUrl(asset)] as const),
);

export function pipipiAssetUrl(file: string) {
	const url = pipipiAssetUrls.get(file);
	if (!url) {
		throw new Error(`Pipipi asset is missing from the canonical media manifest: ${file}`);
	}
	return url;
}

export const PIPIPI_STAGE_BACKGROUND_URL = pipipiAssetUrl("stage-bg.avif");

export const PIPIPI_RUNTIME_ASSET_URLS = Object.freeze(
	pipipiManifest.assets.map(buildPipipiAssetUrl),
);
