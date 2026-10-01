import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { publishCampaignCover } from "./campaign-cover.mjs";
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const bytes = await sharp({ create: { width: 24, height: 16, channels: 3, background: "red" } }).png().toBuffer();
function storage({ corruptRead = false } = {}) {
	const objects = new Map();
	return { objects, async send(command) {
		const { Bucket, Key, Body, ContentType } = command.input;
		const key = `${Bucket}/${Key}`;
		if (command.constructor.name === "PutObjectCommand") { objects.set(key, { bytes: Buffer.from(Body), mime: ContentType }); return {}; }
		const object = objects.get(key);
		if (!object) throw Object.assign(new Error("Missing"), { name: "NoSuchKey" });
		if (command.constructor.name === "HeadObjectCommand") return { ContentLength: object.bytes.length };
		return { ContentType: object.mime, Body: { transformToByteArray: async () => corruptRead ? Buffer.alloc(object.bytes.length) : object.bytes } };
	} };
}
const campaignId = "11111111-1111-4111-8111-111111111111";
test("A/B covers preserve masters, read back both buckets and use separate immutable namespaces", async () => {
	const remote = storage();
	const results = [];
	for (const technicalSlug of ["campaign-a", "campaign-b"]) {
		const workspace = await mkdtemp(join(tmpdir(), "tda-cover-"));
		results.push(await publishCampaignCover({ bytes, campaignId, technicalSlug, workspace, privateClient: remote, publicClient: remote,
			verifyDelivery: async (asset) => {
				assert.deepEqual(remote.objects.get(`tda-media-public/${asset.objectKey}`).bytes, bytes);
				return { httpStatus: 200, challenged: false };
			},
		}));
	}
	assert.notEqual(results[0].cover.objectKey, results[1].cover.objectKey);
	assert.equal(results[0].cover.sha256, results[1].cover.sha256);
	assert.equal(results[0].cover.width, 24);
	assert.equal(results[0].cover.height, 16);
	assert.equal(remote.objects.size, 4);
});
test("invalid decode and corrupt master read-back prevent public upload", async () => {
	for (const input of [{ bytes: Buffer.from("not an image"), corruptRead: false }, { bytes, corruptRead: true }]) {
		const privateClient = storage(input), publicClient = storage();
		await assert.rejects(() => publishCampaignCover({ bytes: input.bytes, campaignId, technicalSlug: "campaign-a", workspace: join(tmpdir(), "unused-cover"), privateClient, publicClient }));
		assert.equal(publicClient.objects.size, 0);
	}
});
test("a public delivery failure never produces a promoted binding", async () => {
	const remote = storage();
	await assert.rejects(() => publishCampaignCover({ bytes, campaignId, technicalSlug: "campaign-a", workspace: join(tmpdir(), "tda-failed-cover"), privateClient: remote, publicClient: remote, verifyDelivery: async () => { throw new Error("R2 delivery unavailable"); } }), /R2 delivery unavailable/);
});
