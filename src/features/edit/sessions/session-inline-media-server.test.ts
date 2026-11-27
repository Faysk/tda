import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectSessionInlineImageMime, SESSION_INLINE_MEDIA_UPLOAD_CHUNK_BYTES, sessionInlinePendingChunkObjectKey } from "./session-inline-media";
import { finalizeSessionInlinePendingUpload, writeSessionInlinePendingUploadChunk } from "./session-inline-media-server";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/integrations/r2/server", () => ({
	mediaClient: () => ({ send }),
	privateMediaClient: () => ({ send }),
}));
vi.mock("@/features/world-explorer/world-entity-media-server", () => ({
	promoteGovernedImageObject: vi.fn(),
}));

type Stored = { bytes: Uint8Array; mime?: string; metadata?: Record<string, string> };
const objects = new Map<string, Stored>();
const campaignSlug = "test-campaign";
const sessionId = "11111111-1111-4111-8111-111111111111";

function syntheticPng(size: number, marker: number) {
	const bytes = Buffer.alloc(size, marker);
	Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12);
	bytes.writeUInt32BE(32, 16);
	bytes.writeUInt32BE(32, 20);
	return bytes;
}

async function stage(bytes: Uint8Array) {
	const uploadId = randomUUID();
	const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
	const expectedMimeType = detectSessionInlineImageMime(bytes);
	if (!expectedMimeType) throw new Error("Invalid test fixture");
	const chunkBytes = SESSION_INLINE_MEDIA_UPLOAD_CHUNK_BYTES;
	for (let part = 0; part * chunkBytes < bytes.length; part++) {
		await writeSessionInlinePendingUploadChunk({
			campaignSlug, sessionId, uploadId, sha256: expectedSha256, part,
			bytes: bytes.slice(part * chunkBytes, (part + 1) * chunkBytes),
		});
	}
	return { campaignSlug, sessionId, uploadId, expectedSha256, expectedMimeType, expectedBytes: bytes.length };
}

describe("inline image upload finalization with simulated private R2", () => {
	beforeEach(() => {
		objects.clear();
		vi.stubEnv("VERCEL_ENV", "production");
		vi.stubEnv("R2_PRIVATE_BUCKET", "tda-media-private");
		send.mockImplementation(async (command: unknown) => {
			if (command instanceof PutObjectCommand) {
				const { Key, Body, ContentType, Metadata } = command.input;
				if (!Key || !(Body instanceof Uint8Array)) throw new Error("Unexpected PUT");
				objects.set(Key, { bytes: Uint8Array.from(Body), mime: ContentType, metadata: Metadata });
				return {};
			}
			if (command instanceof DeleteObjectCommand) {
				if (command.input.Key) objects.delete(command.input.Key);
				return {};
			}
			if (command instanceof HeadObjectCommand || command instanceof GetObjectCommand) {
				const stored = objects.get(command.input.Key ?? "");
				if (!stored) throw Object.assign(new Error("Missing test object"), { name: "NotFound" });
				if (command instanceof HeadObjectCommand)
					return { ContentLength: stored.bytes.length, ContentType: stored.mime, Metadata: stored.metadata };
				return { Body: { transformToByteArray: async () => Uint8Array.from(stored.bytes) } };
			}
			throw new Error("Unexpected R2 command");
		});
	});
	afterEach(() => { vi.unstubAllEnvs(); send.mockReset(); });

	it("finalizes twelve sequential unique images including multipart uploads", async () => {
		const keys = new Set<string>();
		for (let i = 0; i < 12; i++) {
			// Synthetic headers and payloads exercise transport, not image decoding.
			const bytes = syntheticPng(i % 2 ? SESSION_INLINE_MEDIA_UPLOAD_CHUNK_BYTES + 1 : 128, i);
			const intent = await stage(bytes);
			const result = await finalizeSessionInlinePendingUpload(intent);
			expect(result).toMatchObject({ sha256: intent.expectedSha256, mimeType: "image/png", bytes: bytes.length });
			keys.add(result.objectKey);
			expect([...objects.keys()].some((key) => key.startsWith("uploads/pending/"))).toBe(false);
		}
		expect(keys.size).toBe(12);
		expect(objects.size).toBe(12);
	});

	it("rejects a wrong declared MIME, then accepts the same bytes with the detected MIME", async () => {
		const intent = await stage(syntheticPng(128, 7));
		await expect(finalizeSessionInlinePendingUpload({ ...intent, expectedMimeType: "image/webp" }))
			.rejects.toThrow("SESSION_INLINE_MEDIA_UPLOAD_MIME_MISMATCH");
		expect([...objects.keys()].every((key) => key.startsWith("uploads/pending/"))).toBe(true);
		await expect(finalizeSessionInlinePendingUpload(intent)).resolves.toMatchObject({ mimeType: "image/png" });
	});

	it("rejects altered bytes of identical length without writing a permanent object", async () => {
		const intent = await stage(syntheticPng(128, 8));
		const key = sessionInlinePendingChunkObjectKey({ campaignSlug, sessionId, uploadId: intent.uploadId, sha256: intent.expectedSha256, part: 0 });
		if (!key) throw new Error("Missing pending key");
		const stored = objects.get(key);
		if (!stored) throw new Error("Missing test chunk");
		stored.bytes[127] ^= 1;
		await expect(finalizeSessionInlinePendingUpload(intent)).rejects.toThrow("SESSION_INLINE_MEDIA_UPLOAD_HASH_MISMATCH");
		expect([...objects.keys()].every((key) => key.startsWith("uploads/pending/"))).toBe(true);
	});
});
