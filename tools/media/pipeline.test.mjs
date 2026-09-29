import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
	discoverManifests,
	inspectRemote,
	publishAll,
	publicVerificationHeaders,
	publicVerificationUrl,
	readAssetBytes,
	sha256,
	validateAll,
	validateManifest,
	verifyPublicDelivery,
} from "./pipeline.mjs";

async function fixture({ encoding = "binary", namespace = "lore/example" } = {}) {
	const root = await mkdtemp(join(tmpdir(), "tda-media-"));
	await mkdir(join(root, "media/manifests"), { recursive: true });
	await mkdir(join(root, "media/sources/example"), { recursive: true });
	const bytes = Buffer.from("tda-media-pipeline\n");
	const digest = sha256(bytes);
	const source = `media/sources/example/art.bin${encoding === "base64" ? ".b64" : ""}`;
	await writeFile(
		join(root, source),
		encoding === "base64" ? bytes.toString("base64") : bytes,
	);
	const manifest = {
		schemaVersion: 1,
		project: "example-project",
		namespace,
		bucket: "tda-media-public",
		publicOrigin: "https://media.dnd.faysk.dev",
		assets: [
			{
				file: "art.webp",
				source,
				encoding,
				bytes: bytes.length,
				sha256: digest,
				contentType: "image/webp",
			},
		],
	};
	await writeFile(
		join(root, "media/manifests/example.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	return { root, manifest, bytes, digest };
}


async function canonicalFixture() {
	const root = await mkdtemp(join(tmpdir(), "tda-media-remote-"));
	await mkdir(join(root, "media/manifests"), { recursive: true });
	const bytes = Buffer.from("canonical-r2-media\n");
	const digest = sha256(bytes);
	const manifest = {
		schemaVersion: 2,
		project: "remote-project",
		namespace: "lore/remote",
		bucket: "tda-media-public",
		publicOrigin: "https://media.dnd.faysk.dev",
		assets: [
			{
				file: "remote.webp",
				sourceMode: "canonical-r2",
				publicationReceipt: "prod-test-remote",
				canonicalVerifiedAt: "2026-09-29T12:00:00.000Z",
				bytes: bytes.length,
				sha256: digest,
				contentType: "image/webp",
			},
		],
	};
	await writeFile(
		join(root, "media/manifests/remote.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	return { root, manifest, bytes, digest };
}

function remoteClientFor({ bytes, contentType = "image/webp", contentLength = bytes.length, missing = false } = {}) {
	const calls = [];
	return {
		calls,
		async send(command) {
			calls.push(command.constructor.name);
			if (command.constructor.name === "HeadObjectCommand") {
				if (missing) {
					const error = new Error("missing");
					error.name = "NoSuchKey";
					error.$metadata = { httpStatusCode: 404 };
					throw error;
				}
				return { ContentLength: contentLength };
			}
			if (command.constructor.name === "GetObjectCommand") {
				return {
					ContentType: contentType,
					Body: { transformToByteArray: async () => bytes },
				};
			}
			throw new Error(`unexpected remote command: ${command.constructor.name}`);
		},
	};
}

test("empty repositories validate and publish as a no-op without R2 credentials", async () => {
	const root = await mkdtemp(join(tmpdir(), "tda-media-empty-"));
	const validation = await validateAll({ repoRoot: root });
	assert.deepEqual(validation, { manifests: 0, assets: 0, bytes: 0, projects: [] });
	const receipt = await publishAll({ repoRoot: root });
	assert.equal(receipt.summary.assets, 0);
	assert.equal(receipt.summary.verified, 0);
});

test("discovers a manifest and derives immutable content-addressed keys", async () => {
	const { root, digest } = await fixture();
	const [manifest] = await discoverManifests({ repoRoot: root });
	assert.equal(manifest.assets[0].objectKey, `lore/example/${digest}/art.webp`);
	assert.equal(
		manifest.assets[0].publicUrl,
		`https://media.dnd.faysk.dev/lore/example/${digest}/art.webp`,
	);
});

test("validates binary and base64 transport sources by exact bytes and sha256", async () => {
	for (const encoding of ["binary", "base64"]) {
		const { root, bytes } = await fixture({ encoding });
		const result = await validateAll({ repoRoot: root });
		assert.equal(result.assets, 1);
		assert.equal(result.bytes, bytes.length);
	}
});

test("rejects source path traversal and mutable or unsafe identities", async () => {
	const { root, manifest } = await fixture();
	assert.throws(
		() =>
			validateManifest(
				{
					...manifest,
					assets: [{ ...manifest.assets[0], source: "../secret.webp" }],
				},
				{ repoRoot: root },
			),
		/escapes repository root/,
	);
	assert.throws(
		() => validateManifest({ ...manifest, namespace: "../bad" }, { repoRoot: root }),
		/namespace is invalid/,
	);
	assert.throws(
		() =>
			validateManifest(
				{ ...manifest, publicOrigin: "https://media.dnd.faysk.dev/other" },
				{ repoRoot: root },
			),
		/bare https origin/,
	);
	assert.throws(
		() =>
			validateManifest(
				{ ...manifest, bucket: "another-bucket" },
				{ repoRoot: root },
			),
		/bucket must be tda-media-public/,
	);
});

test("rejects local integrity drift before publication", async () => {
	const { root } = await fixture({ encoding: "base64" });
	const manifests = await discoverManifests({ repoRoot: root });
	await writeFile(manifests[0].assets[0].sourcePath, Buffer.from("dGFtcGVyZWQ="));
	await assert.rejects(() => readAssetBytes(manifests[0].assets[0]), /mismatch/);
});



test("schema v2 validates canonical R2 assets without repository source bytes", async () => {
	const { root, bytes } = await canonicalFixture();
	const result = await validateAll({ repoRoot: root });
	assert.deepEqual(result, {
		manifests: 1,
		assets: 1,
		bytes: bytes.length,
		projects: ["remote-project"],
	});
	const [manifest] = await discoverManifests({ repoRoot: root });
	assert.equal(manifest.assets[0].sourceMode, "canonical-r2");
	assert.equal(manifest.assets[0].sourcePath, null);
});

test("canonical R2 manifests require explicit provenance and reject repository source fields", async () => {
	const { root, manifest } = await canonicalFixture();
	const asset = manifest.assets[0];
	assert.throws(
		() =>
			validateManifest(
				{
					...manifest,
					assets: [{ ...asset, publicationReceipt: undefined }],
				},
				{ repoRoot: root },
			),
		/requires publicationReceipt provenance/u,
	);
	assert.throws(
		() =>
			validateManifest(
				{
					...manifest,
					assets: [{ ...asset, canonicalVerifiedAt: "not-a-date" }],
				},
				{ repoRoot: root },
			),
		/requires canonicalVerifiedAt/u,
	);
	assert.throws(
		() =>
			validateManifest(
				{
					...manifest,
					assets: [{ ...asset, source: "media/sources/remote.webp" }],
				},
				{ repoRoot: root },
			),
		/must not declare a repository source/u,
	);
});

test("canonical R2 read-back rejects missing, size, MIME and sha256 drift", async () => {
	const { root, bytes } = await canonicalFixture();
	const [manifest] = await discoverManifests({ repoRoot: root });
	const asset = manifest.assets[0];

	assert.deepEqual(
		await inspectRemote(remoteClientFor({ bytes, missing: true }), manifest, asset),
		{ exists: false },
	);
	await assert.rejects(
		() => inspectRemote(remoteClientFor({ bytes, contentLength: bytes.length + 1 }), manifest, asset),
		/size mismatch/u,
	);
	await assert.rejects(
		() => inspectRemote(remoteClientFor({ bytes, contentType: "image/png" }), manifest, asset),
		/content-type mismatch/u,
	);
	await assert.rejects(
		() => inspectRemote(remoteClientFor({ bytes: Buffer.from("tampered") }), manifest, asset),
		/sha256 mismatch/u,
	);
});

test("source-less publication fails closed when canonical R2 object is absent", async () => {
	const { root, bytes } = await canonicalFixture();
	await assert.rejects(
		() =>
			publishAll({
				repoRoot: root,
				remoteClient: remoteClientFor({ bytes, missing: true }),
				verifyDelivery: async () => ({
					httpStatus: 200,
					contentType: "image/webp",
					challenged: false,
				}),
			}),
		/canonical R2 object is missing/u,
	);
});

test("canonical R2 publication is idempotent reuse after verified read-back", async () => {
	const { root, bytes } = await canonicalFixture();
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const remoteClient = remoteClientFor({ bytes });
		const receipt = await publishAll({
			repoRoot: root,
			remoteClient,
			verifyDelivery: async () => ({
				httpStatus: 200,
				contentType: "image/webp",
				challenged: false,
			}),
		});
		assert.equal(receipt.summary.assets, 1);
		assert.equal(receipt.summary.published, 0);
		assert.equal(receipt.summary.reused, 1);
		assert.equal(receipt.summary.verified, 1);
		assert.deepEqual(remoteClient.calls, ["HeadObjectCommand", "GetObjectCommand"]);
	}
});

test("public verification uses an anonymous browser-image request without credentials", () => {
	const headers = publicVerificationHeaders();
	assert.match(headers["user-agent"], /^Mozilla\/5\.0/u);
	assert.equal(headers["sec-fetch-dest"], "image");
	assert.equal(headers.referer, "https://dnd.faysk.dev/");
	assert.equal(headers.authorization, undefined);
	assert.equal(headers.cookie, undefined);
});

test("public verification uses the exact immutable canonical asset URL", () => {
	const canonical = "https://media.dnd.faysk.dev/lore/yllith/abc/image.webp";
	const verification = publicVerificationUrl(canonical, 1, 123456);
	assert.equal(verification.href, canonical);
	assert.equal(verification.search, "");
});

test("defers only an explicit Cloudflare challenge when staged fallback is enabled", async () => {
	const originalFetch = globalThis.fetch;
	const originalMode = process.env.TDA_MEDIA_PUBLIC_CHALLENGE_MODE;
	try {
		process.env.TDA_MEDIA_PUBLIC_CHALLENGE_MODE = "browser";
		globalThis.fetch = async () =>
			new Response("<html>challenge</html>", {
				status: 403,
				headers: {
					"cf-mitigated": "challenge",
					"content-type": "text/html; charset=UTF-8",
				},
			});
		const result = await verifyPublicDelivery({
			publicUrl: "https://media.dnd.faysk.dev/lore/example/abc/image.avif",
			contentType: "image/avif",
			bytes: 123,
			sha256: "0".repeat(64),
		}, 1);
		assert.equal(result.challenged, true);
		assert.equal(result.httpStatus, 403);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalMode === undefined) delete process.env.TDA_MEDIA_PUBLIC_CHALLENGE_MODE;
		else process.env.TDA_MEDIA_PUBLIC_CHALLENGE_MODE = originalMode;
	}
});

test("does not defer an ordinary 403 without the Cloudflare challenge marker", async () => {
	const originalFetch = globalThis.fetch;
	const originalMode = process.env.TDA_MEDIA_PUBLIC_CHALLENGE_MODE;
	try {
		process.env.TDA_MEDIA_PUBLIC_CHALLENGE_MODE = "browser";
		globalThis.fetch = async () => new Response("forbidden", { status: 403 });
		await assert.rejects(
			() => verifyPublicDelivery({
				publicUrl: "https://media.dnd.faysk.dev/lore/example/abc/image.avif",
				contentType: "image/avif",
				bytes: 123,
				sha256: "0".repeat(64),
			}, 1),
			/HTTP 403/u,
		);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalMode === undefined) delete process.env.TDA_MEDIA_PUBLIC_CHALLENGE_MODE;
		else process.env.TDA_MEDIA_PUBLIC_CHALLENGE_MODE = originalMode;
	}
});
