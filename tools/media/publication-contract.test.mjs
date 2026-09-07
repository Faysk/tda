import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { metadataManifest } from "./publication-contract.mjs";

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
const saved = JSON.parse(
	await readFile(
		new URL(
			"../../docs/integrations/evidence/metadata-image-manifest-2026-09-07.json",
			import.meta.url,
		),
		"utf8",
	),
);

test("all 22 artifacts use the matching runtime source ID, not canonical UUID", () => {
	const manifest = metadataManifest(registry, sources);
	assert.deepEqual(manifest, saved);
	for (const image of registry.images) {
		assert.equal(
			manifest[image.sourceSessionId][image.role].sha256,
			image.sha256,
		);
		assert.equal(manifest[image.sessionId], undefined);
		assert.equal(
			manifest[image.sourceSessionId][image.role].mimeType,
			image.mime,
		);
	}
});

test("a crossed runtime ID cannot silently select another session image", () => {
	const copy = structuredClone(registry);
	copy.images[0].sourceSessionId = copy.images[2].sourceSessionId;
	assert.throws(() => metadataManifest(copy, sources), /association mismatch/);
});

test("swapped content or destination fails even with valid public evidence", () => {
	for (const field of ["sha256", "publicUrl", "objectKey"]) {
		const copy = structuredClone(registry);
		copy.images[0][field] = copy.images[2][field];
		assert.throws(() => metadataManifest(copy, sources), /mismatch/);
	}
});

test("missing pair, duplicate role, missing readback or unverified delivery fail closed", () => {
	const missing = structuredClone(registry);
	missing.images.pop();
	assert.throws(() => metadataManifest(missing, sources), /Incomplete/);
	const duplicate = structuredClone(registry);
	duplicate.images[1] = duplicate.images[0];
	assert.throws(() => metadataManifest(duplicate, sources), /Duplicate/);
	for (const patch of [
		{ readBackVerified: false },
		{ publicDeliveryVerified: false },
		{ publicDeliveryStatus: "not-verified" },
		{ httpStatus: 404 },
		{ httpMime: "text/html" },
	]) {
		const copy = structuredClone(registry);
		Object.assign(copy.images[0], patch);
		assert.throws(() => metadataManifest(copy, sources), /evidence missing/);
	}
});
