import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSources } from "../migrate-session-media-r2.mjs";

// Data adapter only. Runtime metadata selection/building remains owned by #47.
export function metadataManifest(registry, sources) {
	validateSources(sources);
	if (
		registry.schemaVersion !== 1 ||
		registry.kind !== "verified-public-delivery" ||
		registry.images?.length !== 22
	)
		throw Error("Incomplete public registry");
	const result = {};
	const seen = new Set();
	for (const image of registry.images) {
		const identity = `${image.sessionId}/${image.role}`;
		if (seen.has(identity)) throw Error("Duplicate public image identity");
		seen.add(identity);
		const source = sources.images.find(
			(s) => s.sessionId === image.sessionId && s.role === image.role,
		);
		if (!source || image.sourceSessionId !== source.sourceSessionId)
			throw Error("Session association mismatch");
		for (const key of ["sha256", "bytes", "mime", "width", "height"]) {
			if (image[key] !== source.expected[key])
				throw Error("Public image content mismatch");
		}
		const ext = image.mime === "image/png" ? "png" : "webp";
		const expectedKey = `campaigns/yuhara-main/sessions/${image.sessionId}/${image.role}/${image.sha256}.${ext}`;
		if (
			image.bucket !== "tda-media-public" ||
			image.objectKey !== expectedKey ||
			image.publicUrl !== `https://media.dnd.faysk.dev/${expectedKey}`
		)
			throw Error("Public destination mismatch");
		if (
			image.publicDeliveryStatus !== "verified-public" ||
			image.readBackVerified !== true ||
			image.publicDeliveryVerified !== true ||
			image.httpStatus !== 200 ||
			image.httpMime !== image.mime ||
			Number.isNaN(Date.parse(image.verifiedAt))
		)
			throw Error("Public evidence missing");
		result[image.sourceSessionId] ??= {};
		if (result[image.sourceSessionId][image.role])
			throw Error("Duplicate runtime session identity");
		result[image.sourceSessionId][image.role] = {
			state: "verified-public",
			publicUrl: image.publicUrl,
			sha256: image.sha256,
			mimeType: image.mime,
			bytes: image.bytes,
			width: image.width,
			height: image.height,
			verifiedAt: image.verifiedAt,
			readBackVerified: true,
			publicDeliveryVerified: true,
			bucket: image.bucket,
			objectKey: image.objectKey,
			sourceUrl: source.originalUrl,
		};
	}
	if (
		Object.keys(result).length !== 11 ||
		Object.values(result).some((s) => !s.cover || !s.hero)
	)
		throw Error("Incomplete runtime pairs");
	return result;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const sources = JSON.parse(
		await readFile(
			new URL("session-image-sources.json", import.meta.url),
			"utf8",
		),
	);
	const registry = JSON.parse(
		await readFile(
			new URL(
				"../../docs/integrations/evidence/r2-publication-registry-2026-09-07.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	await writeFile(
		new URL(
			"../../docs/integrations/evidence/metadata-image-manifest-2026-09-07.json",
			import.meta.url,
		),
		`${JSON.stringify(metadataManifest(registry, sources), null, 2)}\n`,
	);
	console.log(
		"PUBLIC_METADATA_DATA_OK 11 sessions / 22 images; no runtime promotion",
	);
}
