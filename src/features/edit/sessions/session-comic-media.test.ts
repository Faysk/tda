import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { inspectWorldEntityImage } from "@/features/world-explorer/world-entity-media-image";
import {
	isSessionComicUploadIntent,
	SESSION_COMIC_MEDIA_ROLE,
	sessionComicObjectKey,
	sessionComicPendingChunkObjectKey,
	sessionComicPreviewUrl,
} from "./session-comic-media";

const sessionId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
const uploadId = "33333333-3333-4333-8333-333333333333";
const hash = "a".repeat(64);

describe("comic media identity", () => {
	it("uses its own role and immutable session/campaign scope", () => {
		expect(SESSION_COMIC_MEDIA_ROLE).toBe("session_comic_page");
		expect(sessionComicObjectKey({
			campaignSlug: "yuhara-main",
			sessionId,
			sha256: hash,
			extension: "webp",
		})).toBe(
			"campaigns/yuhara-main/sessions/" + sessionId + "/comic/" + hash + ".webp",
		);
		expect(sessionComicObjectKey({
			campaignSlug: "other-campaign",
			sessionId,
			sha256: hash,
			extension: "png",
		})).toBe(
			"campaigns/other-campaign/sessions/" + sessionId + "/comic/" + hash + ".png",
		);
	});

	it("prevents traversal, invalid hashes and crossed session identifiers", () => {
		for (const campaignSlug of ["../other", "a/b", "", "private/.."]) {
			expect(sessionComicObjectKey({
				campaignSlug,
				sessionId,
				sha256: hash,
				extension: "png",
			})).toBeNull();
		}
		expect(sessionComicObjectKey({
			campaignSlug: "yuhara-main",
			sessionId: "other",
			sha256: hash,
			extension: "png",
		})).toBeNull();
		expect(sessionComicObjectKey({
			campaignSlug: "yuhara-main",
			sessionId,
			sha256: "invalid-hash",
			extension: "png",
		})).toBeNull();
	});

	it("creates separate private upload chunk keys and bounds part indices", () => {
		const input = {
			campaignSlug: "yuhara-main",
			sessionId,
			uploadId,
			sha256: hash,
			part: 0,
		};
		expect(sessionComicPendingChunkObjectKey(input)).toBe(
			"uploads/pending/session-comic/yuhara-main/" + sessionId + "/" +
				uploadId + "/" + hash + ".part-00",
		);
		expect(sessionComicPendingChunkObjectKey({ ...input, part: -1 })).toBeNull();
		expect(sessionComicPendingChunkObjectKey({ ...input, part: 1_000_000 })).toBeNull();
		expect(sessionComicPendingChunkObjectKey({ ...input, part: 1.5 })).toBeNull();
		expect(sessionComicPreviewUrl(sessionId, assetId)).toBe(
			"/api/edit/session-comic/" + sessionId + "/" + assetId,
		);
		expect(sessionComicPreviewUrl(sessionId, "unknown")).toBeUndefined();
	});

	it("recognizes synthetic portrait PNG and landscape WebP from their bytes", () => {
		const png = Buffer.alloc(24);
		Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0);
		png.writeUInt32BE(13, 8);
		png.write("IHDR", 12, "ascii");
		png.writeUInt32BE(800, 16);
		png.writeUInt32BE(1200, 20);

		const webp = Buffer.alloc(30);
		webp.write("RIFF", 0, "ascii");
		webp.writeUInt32LE(22, 4);
		webp.write("WEBP", 8, "ascii");
		webp.write("VP8X", 12, "ascii");
		webp.writeUInt32LE(10, 16);
		const w = 1600 - 1, h = 900 - 1;
		for (let i = 0; i < 3; i += 1) {
			webp[24 + i] = (w >>> (i * 8)) & 0xff;
			webp[27 + i] = (h >>> (i * 8)) & 0xff;
		}
		for (const [bytes, mimeType, width, height, extension] of [
			[png, "image/png", 800, 1200, "png"],
			[webp, "image/webp", 1600, 900, "webp"],
		] as const) {
			const info = inspectWorldEntityImage(bytes);
			expect(info).toMatchObject({ mimeType, width, height, extension });
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			expect(info.sha256).toBe(sha256);
			expect(isSessionComicUploadIntent({ sha256, mimeType, bytes: bytes.length })).toBe(true);
			expect(
				sessionComicObjectKey({
					campaignSlug: "yuhara-main",
					sessionId,
					sha256,
					extension,
				}),
			).toBe(
				"campaigns/yuhara-main/sessions/" + sessionId +
					"/comic/" + sha256 + "." + extension,
			);
		}
	});

	it("accepts only bounded PNG/WebP upload declarations", () => {
		expect(isSessionComicUploadIntent({
			sha256: hash,
			mimeType: "image/webp",
			bytes: 1024,
		})).toBe(true);
		expect(isSessionComicUploadIntent({
			sha256: hash,
			mimeType: "image/jpeg",
			bytes: 1024,
		})).toBe(false);
		expect(isSessionComicUploadIntent({
			sha256: hash,
			mimeType: "image/webp",
			bytes: -1,
		})).toBe(false);
		expect(isSessionComicUploadIntent({
			sha256: hash,
			mimeType: "image/png",
			bytes: 1024,
			sourceUrl: "https://example.com",
		})).toBe(false);
	});
});
