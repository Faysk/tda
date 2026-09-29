import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const EXPECTED_SHA256 =
	"e8d0b33395b023d973cacbb68fa7b120f795d4a19b9518767010ec50a152e6f2";
const EXPECTED_BYTES = 326;
const EXPECTED_FILE = "favicon.svg";
const EXPECTED_SOURCE = "media/sources/d/favicon.svg";
const EXPECTED_ORIGIN = "https://media.dnd.faysk.dev";
const EXPECTED_NAMESPACE = "lore/d";
const EXPECTED_URL =
	`${EXPECTED_ORIGIN}/${EXPECTED_NAMESPACE}/${EXPECTED_SHA256}/${EXPECTED_FILE}`;

async function manifest() {
	return JSON.parse(await readFile("media/manifests/d-ui.json", "utf8"));
}

test("D favicon manifest preserves the approved historical identity", async () => {
	const current = await manifest();
	assert.equal(current.schemaVersion, 2);
	assert.equal(current.project, "d-lore-ui");
	assert.equal(current.bucket, "tda-media-public");
	assert.equal(current.namespace, EXPECTED_NAMESPACE);
	assert.equal(current.publicOrigin, EXPECTED_ORIGIN);
	assert.equal(current.assets.length, 1);

	const [asset] = current.assets;
	assert.equal(asset.file, EXPECTED_FILE);
	assert.equal(asset.bytes, EXPECTED_BYTES);
	assert.equal(asset.sha256, EXPECTED_SHA256);
	assert.equal(asset.contentType, "image/svg+xml");

	if (asset.sourceMode === "repository") {
		assert.equal(asset.source, EXPECTED_SOURCE);
		const bytes = await readFile(asset.source);
		assert.equal(bytes.length, EXPECTED_BYTES);
		assert.equal(createHash("sha256").update(bytes).digest("hex"), EXPECTED_SHA256);
		assert.match(bytes.toString("utf8"), /aria-label="D\."/u);
		return;
	}

	assert.equal(asset.sourceMode, "canonical-r2");
	assert.equal(asset.source, undefined);
	assert.match(asset.publicationReceipt ?? "", /^prod-[a-f0-9]{12}$/u);
	assert.ok(!Number.isNaN(Date.parse(asset.canonicalVerifiedAt)));
});

test("D standalone page consumes exactly the canonical content-addressed favicon", async () => {
	const html = await readFile("public/lore/d/index.html", "utf8");
	const escapedUrl = EXPECTED_URL.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const matches = html.match(new RegExp(escapedUrl, "gu")) ?? [];
	assert.equal(matches.length, 1);
	assert.match(
		html,
		new RegExp(
			`<link\\s+rel="icon"\\s+href="${escapedUrl}"\\s+type="image/svg\\+xml"\\s*/>`,
			"u",
		),
	);
});
