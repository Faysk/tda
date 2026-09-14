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
	await writeFile(
		join(root, "media/manifests/example.json"),
		`${JSON.stringify(
			{
				schemaVersion: 1,
				project: "example-project",
				namespace: "lore/example",
				bucket: "tda-media-public",
				publicOrigin: "https://media.dnd.faysk.dev",
				assets: [
					{
						file: "art.webp",
						source,
						encoding: "binary",
						bytes: bytes.length,
						sha256: digest,
						contentType: "image/webp",
					},
				],
			},
			null,
			2,
		)}\n`,
	);
	return { root, bytes, digest };
}

test("public verification succeeds without R2 credentials and writes a receipt", async () => {
	const { root, bytes, digest } = await fixture();
	const requests = [];
	const receipt = await verifyPublicAll({
		repoRoot: root,
		receiptPath: ".local/public.json",
		attempts: 1,
		fetchImpl: async (url, options) => {
			requests.push({ url: new URL(url), options });
			return new Response(bytes, {
				status: 200,
				headers: { "content-type": "image/webp" },
			});
		},
	});

	assert.equal(receipt.kind, "tda-media-public-verification-receipt");
	assert.deepEqual(receipt.summary, { projects: 1, assets: 1, verified: 1 });
	assert.equal(receipt.assets[0].sha256, digest);
	assert.equal(receipt.assets[0].publicDeliveryVerified, true);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url.searchParams.has("tda_verify"), true);
	assert.equal(requests[0].options.cache, "no-store");
	assert.equal(requests[0].options.headers["cache-control"], "no-cache");

	const persisted = JSON.parse(await readFile(join(root, ".local/public.json"), "utf8"));
	assert.equal(persisted.manifestSetSha256, receipt.manifestSetSha256);
	assert.equal(persisted.summary.verified, 1);
});

test("public verification rejects delivery byte drift", async () => {
	const { root } = await fixture();
	await assert.rejects(
		() =>
			verifyPublicAll({
				repoRoot: root,
				attempts: 1,
				fetchImpl: async () =>
					new Response(Buffer.from("tampered\n"), {
						status: 200,
						headers: { "content-type": "image/webp" },
					}),
			}),
		/bytes .* !=/,
	);
});

test("public verification rejects delivery MIME drift", async () => {
	const { root, bytes } = await fixture();
	await assert.rejects(
		() =>
			verifyPublicAll({
				repoRoot: root,
				attempts: 1,
				fetchImpl: async () =>
					new Response(bytes, {
						status: 200,
						headers: { "content-type": "text/html" },
					}),
			}),
		/content-type text\/html != image\/webp/,
	);
});
