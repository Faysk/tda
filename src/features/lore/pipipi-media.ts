import pipipiManifest from "../../../media/manifests/pipipi.json";

type PipipiManifestAsset = Readonly<{
	file: string;
	bytes: number;
	sha256: string;
	contentType: string;
}>;

type PipipiManifest = Readonly<{
	publicOrigin: string;
	namespace: string;
	assets: readonly PipipiManifestAsset[];
}>;

const manifest = pipipiManifest as PipipiManifest;

export function pipipiMediaAsset(file: string) {
	const asset = manifest.assets.find((candidate) => candidate.file === file);
	if (!asset) {
		throw new Error(`Pipipi media manifest is missing ${file}`);
	}

	return {
		...asset,
		publicUrl: `${manifest.publicOrigin}/${manifest.namespace}/${asset.sha256}/${asset.file}`,
	} as const;
}

export const PIPIPI_STAGE_BACKGROUND = pipipiMediaAsset("stage-bg.avif");
