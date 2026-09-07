import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { hash } from "../migrate-session-media-r2.mjs";
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const input = JSON.parse(
	await readFile(".local/lore-assets/prepared.json", "utf8"),
);
for (const pack of input.packages) {
	pack.identity =
		pack.packageId === "pipipi-lore-premium"
			? { kind: "editorial-lore", stableId: "pipipi", entityUuid: null }
			: {
					kind: "technical-demo",
					stableId: "parallax-art-demo-v1",
					canonical: false,
					entityUuid: null,
				};
	for (const image of pack.assets) {
		const bytes = await readFile(`.local/lore-assets/${image.localPath}`);
		if (hash(bytes) !== image.sha256) throw Error("Hash mismatch");
		const d = sharp(bytes, { failOn: "warning", limitInputPixels: 40000000 });
		const m = await d.metadata();
		await d.stats();
		image.mime = m.format === "svg" ? "image/svg+xml" : `image/${m.format}`;
		image.width = m.width;
		image.height = m.height;
		image.role =
			pack.packageId === "parallax_art_demo"
				? "cinematic-layer"
				: image.assetId === "pipipi"
					? "hero-preview"
					: "scene";
		image.bucket = "tda-media-public";
		image.objectKey =
			pack.packageId === "pipipi-lore-premium"
				? `lore/pipipi/${image.sha256}/${image.filename}`
				: `demos/parallax-art-demo-v1/${pack.assetSetSha256}/assets/${image.filename}`;
		image.plannedPublicUrl = `https://media.dnd.faysk.dev/${image.objectKey}`;
		image.publicUrl = null;
		image.publicDeliveryStatus = "not-verified";
		image.uploadStatus = "not-uploaded";
		image.verificationStatus = "local-decoded-sha256";
	}
}
input.preparedAt = new Date().toISOString();
input.remoteWrites = 0;
await writeFile(
	"docs/integrations/evidence/lore-assets-prepared-2026-09-07.json",
	`${JSON.stringify(input, null, 2)}\n`,
);
console.log(
	"LORE_ASSETS_VALIDATED",
	input.packages.map((p) => ({
		id: p.packageId,
		assets: p.assets.length,
		bytes: p.assets.reduce((s, a) => s + a.bytes, 0),
	})),
);
