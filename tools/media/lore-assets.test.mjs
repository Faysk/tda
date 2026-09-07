import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLorePlan, stage } from "./stage-lore-assets.mjs";
const plan = JSON.parse(
	await readFile(
		new URL(
			"../../docs/integrations/evidence/lore-assets-prepared-2026-09-07.json",
			import.meta.url,
		),
		"utf8",
	),
);
test("reviewed packs are exactly seven lore images and eight noncanonical demo layers", () =>
	validateLorePlan(plan));
test("changed bytes, duplicate layer, traversal, private bucket and premature publication fail", () => {
	for (const change of [
		(a) => {
			a.sha256 = "0".repeat(64);
		},
		(a) => {
			a.localPath = "../../secret";
		},
		(a) => {
			a.bucket = "tda-media-private";
		},
		(a) => {
			a.publicUrl = a.plannedPublicUrl;
		},
		(a) => {
			a.filename = "audio.mp3";
		},
	]) {
		const copy = structuredClone(plan);
		change(copy.packages[0].assets[0]);
		assert.throws(() => validateLorePlan(copy));
	}
	const duplicate = structuredClone(plan);
	duplicate.packages[1].assets[1] = duplicate.packages[1].assets[0];
	assert.throws(() => validateLorePlan(duplicate));
});
test("SVG requires static-profile validation and unknown scope cannot upload", async () => {
	const copy = structuredClone(plan);
	delete copy.packages[1].assets[0].svgValidation;
	assert.throws(() => validateLorePlan(copy), /Unreviewed SVG/);
	await assert.rejects(stage(["--upload"]), /one explicit package/);
	await assert.rejects(stage(["--package", "other"]), /Unknown package/);
});
