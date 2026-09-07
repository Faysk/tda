import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
	assertExpected,
	assertLiveAssociations,
	download,
	inspectImage,
	main,
	preserveLocal,
	processObject,
	validateSources,
} from "../migrate-session-media-r2.mjs";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const inventory = JSON.parse(
	await readFile(
		new URL("session-image-sources.json", import.meta.url),
		"utf8",
	),
);
const bytes = await sharp({
	create: { width: 24, height: 16, channels: 3, background: "red" },
})
	.webp()
	.toBuffer();
const info = await inspectImage(bytes);
const image = {
	...info,
	objectKey: `campaigns/yuhara-main/sessions/test/cover/${info.sha256}.webp`,
};
const missing = () =>
	Object.assign(Error("missing"), {
		name: "NotFound",
		$metadata: { httpStatusCode: 404 },
	});
const head = () => ({
	ContentLength: bytes.length,
	ContentType: image.mime,
	Metadata: { sha256: image.sha256 },
});
function fakeS3(initial = null, readback = bytes) {
	let stored = initial;
	const calls = [];
	return {
		calls,
		send: async (command) => {
			calls.push(command);
			switch (command.constructor.name) {
				case "HeadObjectCommand":
					if (!stored) throw missing();
					return stored;
				case "PutObjectCommand":
					assert.equal(command.input.IfNoneMatch, "*");
					stored = head();
					return {};
				case "GetObjectCommand":
					return {
						ContentType: image.mime,
						Body: { transformToByteArray: async () => readback },
					};
				default:
					throw Error("Unexpected mutation");
			}
		},
	};
}

test("inventory has 11 complete pairs and pinned expected hashes", () =>
	validateSources(inventory));
test("rejects duplicate role and crossed session URL", () => {
	const duplicate = structuredClone(inventory);
	duplicate.images[1] = duplicate.images[0];
	assert.throws(() => validateSources(duplicate), /DUPLICATE_ROLE/);
	const crossed = structuredClone(inventory);
	crossed.images[0].resolvedSourceUrl = crossed.images[2].resolvedSourceUrl;
	assert.throws(() => validateSources(crossed), /SOURCE_ASSOCIATION_MISMATCH/);
});
test("rejects credential-bearing URLs", () => {
	const changed = structuredClone(inventory);
	changed.images[0].originalUrl += "?token=synthetic";
	assert.throws(() => validateSources(changed), /UNSAFE_SOURCE_URL/);
});
test("live DB association drift fails closed", () => {
	const rows = inventory.images
		.filter((i) => i.role === "cover")
		.map((i) => ({
			id: i.sessionId,
			source_session_id: i.sourceSessionId,
			session_date: i.sessionDate,
			cover: i.originalUrl,
			hero: inventory.images.find(
				(j) => j.sessionId === i.sessionId && j.role === "hero",
			).originalUrl,
		}));
	assertLiveAssociations(inventory, rows);
	rows[0].hero = rows[1].hero;
	assert.throws(
		() => assertLiveAssociations(inventory, rows),
		/LIVE_ASSOCIATION_CHANGED/,
	);
});
test("decodes WebP and PNG by bytes, independent of filename/HTTP MIME", async () => {
	assert.deepEqual(
		[info.mime, info.width, info.height],
		["image/webp", 24, 16],
	);
	const png = await sharp(bytes).png().toBuffer();
	const result = await inspectImage(png);
	assert.equal(result.mime, "image/png");
	assert.equal(result.extension, "png");
});
test("rejects HTML, truncated WebP and corrupted PNG data", async () => {
	await assert.rejects(
		inspectImage(Buffer.from("<html>not an image</html>")),
		/INVALID_IMAGE_CONTAINER/,
	);
	await assert.rejects(
		inspectImage(bytes.subarray(0, bytes.length - 1)),
		/INVALID_WEBP_CONTAINER/,
	);
	const png = await sharp(bytes).png().toBuffer();
	await assert.rejects(inspectImage(png.subarray(0, 40)));
});

test("a .webp URL and image/webp HTTP header cannot relabel PNG bytes", async () => {
	const png = await sharp(bytes).png().toBuffer();
	const recovered = await download(
		"https://example.com/card.webp",
		async () =>
			new Response(png, { headers: { "content-type": "image/webp" } }),
	);
	assert.deepEqual(recovered, png);
	const decoded = await inspectImage(recovered);
	assert.equal(decoded.mime, "image/png");
	assert.equal(decoded.extension, "png");
});
test("source bytes changed since reviewed inventory cannot be promoted", () => {
	assertExpected({ expected: info }, info);
	assert.throws(
		() =>
			assertExpected({ expected: info }, { ...info, sha256: "0".repeat(64) }),
		/SOURCE_CONTENT_CHANGED/,
	);
});
test("local retry skips identical and preserves original on collision", async () => {
	const dir = await mkdtemp(join(tmpdir(), "tda-media-test-"));
	try {
		const path = join(dir, "original.webp");
		assert.equal(await preserveLocal(path, bytes), "saved");
		assert.equal(await preserveLocal(path, bytes), "skip");
		await assert.rejects(
			preserveLocal(path, Buffer.from("different")),
			/LOCAL_COLLISION/,
		);
		assert.deepEqual(await readFile(path), bytes);
	} finally {
		await rm(dir, { recursive: true });
	}
});
test("dry-run performs HEAD only for missing objects", async () => {
	const client = fakeS3();
	const result = await processObject(client, image, bytes);
	assert.equal(result.uploadStatus, "not-uploaded");
	assert.deepEqual(
		client.calls.map((c) => c.constructor.name),
		["HeadObjectCommand"],
	);
});
test("upload then retry is idempotent, both verify GET bytes", async () => {
	const client = fakeS3();
	assert.equal(
		(await processObject(client, image, bytes, { upload: true })).uploadStatus,
		"uploaded",
	);
	assert.equal(
		(await processObject(client, image, bytes, { upload: true })).uploadStatus,
		"skipped-identical",
	);
	assert.deepEqual(
		client.calls.map((c) => c.constructor.name),
		[
			"HeadObjectCommand",
			"PutObjectCommand",
			"GetObjectCommand",
			"HeadObjectCommand",
			"GetObjectCommand",
		],
	);
});
test("HEAD metadata alone cannot prove identical content", async () => {
	const client = fakeS3(head(), Buffer.alloc(bytes.length));
	await assert.rejects(
		processObject(client, image, bytes),
		/R2_READBACK_FAILED/,
	);
	assert.equal(
		client.calls.some((c) => c.constructor.name === "PutObjectCommand"),
		false,
	);
});
for (const changed of [
	{ ContentLength: 1 },
	{ ContentType: "text/html" },
	{ Metadata: {} },
]) {
	test(`HEAD collision aborts without PUT: ${Object.keys(changed)[0]}`, async () => {
		const client = fakeS3({ ...head(), ...changed });
		await assert.rejects(
			processObject(client, image, bytes, { upload: true }),
			/R2_COLLISION/,
		);
		assert.equal(client.calls.length, 1);
	});
}
test("403 and NoSuchBucket never become permission to PUT", async () => {
	for (const error of [
		Object.assign(Error(), { $metadata: { httpStatusCode: 403 } }),
		Object.assign(missing(), { name: "NoSuchBucket" }),
	]) {
		let count = 0;
		const client = {
			send: async () => {
				count++;
				throw error;
			},
		};
		await assert.rejects(processObject(client, image, bytes, { upload: true }));
		assert.equal(count, 1);
	}
});
test("conditional-write race aborts without an unconditional retry", async () => {
	const calls = [];
	const client = {
		send: async (c) => {
			calls.push(c);
			if (calls.length === 1) throw missing();
			assert.equal(c.input.IfNoneMatch, "*");
			throw Object.assign(Error("race"), {
				$metadata: { httpStatusCode: 412 },
			});
		},
	};
	await assert.rejects(
		processObject(client, image, bytes, { upload: true }),
		/race/,
	);
	assert.equal(calls.length, 2);
});
test("post-upload corrupt readback and local mismatch fail", async () => {
	await assert.rejects(
		processObject(fakeS3(null, Buffer.from("bad")), image, bytes, {
			upload: true,
		}),
		/R2_READBACK_FAILED/,
	);
	const client = fakeS3();
	await assert.rejects(
		processObject(client, image, Buffer.from("bad")),
		/LOCAL_INTEGRITY_FAILED/,
	);
	assert.equal(client.calls.length, 0);
});
test("download rejects HTTP errors, HTML and excessive lengths; disables redirects", async () => {
	for (const response of [
		new Response("bad", { status: 404 }),
		new Response("<html>", { headers: { "content-type": "text/html" } }),
		new Response("x", {
			headers: { "content-type": "image/webp", "content-length": "999999999" },
		}),
	]) {
		await assert.rejects(
			download("https://example.com/image", async (_url, options) => {
				assert.equal(options.redirect, "error");
				return response;
			}),
		);
	}
});
test("CLI rejects unknown flags and upload without live DB check before I/O", async () => {
	await assert.rejects(main(["--uplod"]));
	await assert.rejects(main(["--upload"]), /UPLOAD_REQUIRES_LIVE_ASSOCIATIONS/);
});
