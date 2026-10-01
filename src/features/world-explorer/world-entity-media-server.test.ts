import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const r2 = vi.hoisted(() => {
	const objects = new Map<
		string,
		{ bytes: Uint8Array; mimeType: string; sha256: string }
	>();
	const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
		const kind = command.constructor.name;
		const bucket = String(command.input.Bucket ?? "");
		const key = String(command.input.Key ?? "");
		const storageKey = bucket + "/" + key;
		const current = objects.get(storageKey);
		if (kind === "HeadObjectCommand") {
			if (!current) {
				throw {
					name: "NotFound",
					$metadata: { httpStatusCode: 404 },
				};
			}
			return {
				ContentLength: current.bytes.length,
				ContentType: current.mimeType,
				Metadata: { sha256: current.sha256 },
			};
		}
		if (kind === "GetObjectCommand") {
			if (!current) {
				throw {
					name: "NoSuchKey",
					$metadata: { httpStatusCode: 404 },
				};
			}
			return {
				ContentLength: current.bytes.length,
				Body: {
					transformToByteArray: async () => current.bytes,
				},
			};
		}
		if (kind === "PutObjectCommand") {
			if (current && command.input.IfNoneMatch === "*") {
				throw {
					name: "PreconditionFailed",
					$metadata: { httpStatusCode: 412 },
				};
			}
			const body = Uint8Array.from(command.input.Body as Uint8Array);
			objects.set(storageKey, {
				bytes: body,
				mimeType: String(command.input.ContentType ?? ""),
				sha256: String(
					(command.input.Metadata as Record<string, unknown> | undefined)
						?.sha256 ?? "",
				),
			});
			return {};
		}
		if (kind === "DeleteObjectCommand") {
			objects.delete(storageKey);
			return {};
		}
		throw new Error("unexpected command " + kind);
	});
	return { objects, send };
});

vi.mock("server-only", () => ({}));

vi.mock("@/integrations/r2/server", () => ({
	mediaClient: () => ({ send: r2.send }),
	privateMediaClient: () => ({ send: r2.send }),
}));

import {
	WORLD_ENTITY_MEDIA_PRIVATE_BUCKET,
	WORLD_ENTITY_MEDIA_PREVIEW_BUCKET,
	WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
} from "./world-entity-media";
import { inspectWorldEntityImage } from "./world-entity-media-image";
import { promoteGovernedImageObject } from "./world-entity-media-server";

function png(width = 640, height = 360): Uint8Array {
	const bytes = Buffer.alloc(24);
	Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12, "ascii");
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return Uint8Array.from(bytes);
}

function sha256(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}

function seed(
	bucket: string,
	objectKey: string,
	bytes: Uint8Array,
	mimeType = "image/png",
) {
	r2.objects.set(bucket + "/" + objectKey, {
		bytes,
		mimeType,
		sha256: sha256(bytes),
	});
}

describe("governed public image promotion", () => {
	beforeEach(() => {
		r2.objects.clear();
		r2.send.mockClear();
		vi.unstubAllGlobals();
		process.env.R2_PUBLIC_BUCKET = WORLD_ENTITY_MEDIA_PUBLIC_BUCKET;
	});

	it("verifies staged bytes, immutable public read-back and public delivery", async () => {
		const bytes = png();
		const info = inspectWorldEntityImage(bytes);
		const objectKey =
			"campaigns/campaign-a/campaign/cover/" + info.sha256 + ".png";
		seed(WORLD_ENTITY_MEDIA_PREVIEW_BUCKET, objectKey, bytes);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(Uint8Array.from(bytes).buffer, {
					status: 200,
					headers: {
						"content-type": info.mimeType,
						"content-length": String(bytes.length),
					},
				}),
			),
		);

		const result = await promoteGovernedImageObject({
			stagedBucket: WORLD_ENTITY_MEDIA_PREVIEW_BUCKET,
			objectKey,
			expectedObjectKey: objectKey,
			info,
		});

		expect(result.publicBucket).toBe(WORLD_ENTITY_MEDIA_PUBLIC_BUCKET);
		expect(result.publicObjectKey).toBe(objectKey);
		expect(result.publicUrl).toBe(
			"https://media.dnd.faysk.dev/" + objectKey,
		);
			const stored = r2.objects.get(
			WORLD_ENTITY_MEDIA_PUBLIC_BUCKET + "/" + objectKey,
		);
		expect(stored).toBeDefined();
		expect(Buffer.from(stored?.bytes ?? [])).toEqual(bytes);
	});

	it("supports the production private staging bucket without exposing it directly", async () => {
		const bytes = png(800, 450);
		const info = inspectWorldEntityImage(bytes);
		const objectKey =
			"campaigns/campaign-b/sessions/11111111-1111-4111-8111-111111111111/cover/" +
			info.sha256 +
			".png";
		seed(WORLD_ENTITY_MEDIA_PRIVATE_BUCKET, objectKey, bytes);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(Uint8Array.from(bytes).buffer, {
					status: 200,
					headers: { "content-type": info.mimeType },
				}),
			),
		);

		await expect(
			promoteGovernedImageObject({
				stagedBucket: WORLD_ENTITY_MEDIA_PRIVATE_BUCKET,
				objectKey,
				expectedObjectKey: objectKey,
				info,
			}),
		).resolves.toMatchObject({
			publicBucket: WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
			publicObjectKey: objectKey,
		});
	});

	it("fails closed when public R2/CDN delivery cannot be read back", async () => {
		const bytes = png();
		const info = inspectWorldEntityImage(bytes);
		const objectKey =
			"campaigns/campaign-a/campaign/cover/" + info.sha256 + ".png";
		seed(WORLD_ENTITY_MEDIA_PREVIEW_BUCKET, objectKey, bytes);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 503 })),
		);

		await expect(
			promoteGovernedImageObject({
				stagedBucket: WORLD_ENTITY_MEDIA_PREVIEW_BUCKET,
				objectKey,
				expectedObjectKey: objectKey,
				info,
			}),
		).rejects.toThrow("WORLD_ENTITY_MEDIA_PUBLIC_DELIVERY_FAILED");
	});

	it("rejects a mismatched owner/key before touching R2", async () => {
		const bytes = png();
		const info = inspectWorldEntityImage(bytes);
		const objectKey =
			"campaigns/campaign-a/campaign/cover/" + info.sha256 + ".png";
		await expect(
			promoteGovernedImageObject({
				stagedBucket: WORLD_ENTITY_MEDIA_PREVIEW_BUCKET,
				objectKey,
				expectedObjectKey: objectKey.replace("campaign-a", "campaign-b"),
				info,
			}),
		).rejects.toThrow("WORLD_ENTITY_MEDIA_OBJECT_SCOPE_MISMATCH");
		expect(r2.send).not.toHaveBeenCalled();
	});
});
