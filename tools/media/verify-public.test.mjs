import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { sha256 } from "./pipeline.mjs";
import { verifyPublicAll } from "./verify-public.mjs";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "tda-media-public-verify-"));
	await mkdir(join(root, "media/manifests"), { recursive: true });
	await mkdir(join(root, "media/sources/example"), { recursive: true });
	const bytes = Buffer.from("immutable-public-media\n");
	const digest = sha256(bytes);
	const source = "media/sources/example/art.webp";
	await writeFile(join(root, source), bytes);
	await writeFile(join(root, "media/manifests/example.json"), JSON.stringify({
		schemaVersion: 1,
		project: "example-project",
		namespace: "lore/example",
		bucket: "tda-media-public",
		publicOrigin: "https://media.dnd.faysk.dev",
		assets: [{ file: "art.webp", source, encoding: "binary", bytes: bytes.length, sha256: digest, contentType: "image/webp" }],
	}, null, 2));
	return { root, bytes, digest };
}

test("public verification succeeds without storage credentials", async () => {
	const { root, bytes, digest } = await fixture();
	const receipt = await verifyPublicAll({
		repoRoot: root,
		receiptPath: ".local/public.json",
		attempts: 1,
		fetchImpl: async () => new Response(bytes, { status: 200, headers: { "content-type": "image/webp" } }),
	});
	assert.deepEqual(receipt.summary, { projects: 1, assets: 1, verified: 1 });
	assert.equal(receipt.assets[0].sha256, digest);
	assert.equal(receipt.assets[0].verificationMode, "canonical");
	const persisted = JSON.parse(await readFile(join(root, ".local/public.json"), "utf8"));
	assert.equal(persisted.summary.verified, 1);
});

test("public verification requests only the immutable canonical URL with anonymous image headers", async () => {
	const { root, bytes } = await fixture();
	const calls = [];
	const receipt = await verifyPublicAll({
		repoRoot: root,
		receiptPath: ".local/public-canonical.json",
		attempts: 1,
		fetchImpl: async (input, options) => {
			calls.push({ url: String(input), headers: options?.headers });
			return new Response(bytes, { status: 200, headers: { "content-type": "image/webp" } });
		},
	});
	assert.equal(calls.length, 1);
	assert.equal(new URL(calls[0].url).search, "");
	assert.match(calls[0].headers["user-agent"], /^Mozilla\/5\.0/u);
	assert.equal(calls[0].headers.cookie, undefined);
	assert.equal(calls[0].headers.authorization, undefined);
	assert.equal(receipt.assets[0].verificationMode, "canonical");
});

test("public verification remains fail-closed when canonical delivery fails", async () => {
	const { root } = await fixture();
	await assert.rejects(
		verifyPublicAll({
			repoRoot: root,
			receiptPath: ".local/public-failure.json",
			attempts: 1,
			fetchImpl: async () => new Response("forbidden", { status: 403 }),
		}),
		/public media verification failed.*HTTP 403/,
	);
});


test("canonical R2 sources are verified remotely without a repository master", async () => {
 const { root, bytes } = await fixture();
 const path = join(root, "media/manifests/example.json");
 const manifest = JSON.parse(await readFile(path, "utf8"));
 manifest.schemaVersion = 2;
 const asset = manifest.assets[0];
 delete asset.source; delete asset.encoding;
 Object.assign(asset, { sourceMode: "canonical-r2", publicationReceipt: "docs/media-receipt.md", canonicalVerifiedAt: "2026-10-01T00:00:00Z" });
 await writeFile(path, JSON.stringify(manifest));
 const receipt = await verifyPublicAll({ repoRoot: root, attempts: 1, fetchImpl: async () => new Response(bytes, { headers: { "content-type": "image/webp" } }) });
 assert.equal(receipt.summary.verified, 1);
 await assert.rejects(verifyPublicAll({ repoRoot: root, attempts: 1, fetchImpl: async () => new Response(Buffer.alloc(bytes.length), { headers: { "content-type": "image/webp" } }) }), /sha256 mismatch/);
});
