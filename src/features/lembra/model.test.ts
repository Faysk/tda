import { describe, expect, it } from "vitest";
import {
	LEMBRA_MAX_BYTES,
	LEMBRA_UPLOAD_CHUNK_BYTES,
	lembraPendingChunkObjectKey,
	lembraPendingObjectKey,
	lembraReferenceObjectKey,
	lembraUploadChunkCount,
	validLembraDescription,
	validLembraTitle,
	validLembraUploadIntent,
} from "./model";

const referenceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const uploadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sha = "c".repeat(64);

describe("Lembra persistence model", () => {
	it("builds global shared immutable and pending object keys", () => {
		expect(
			lembraReferenceObjectKey({
				referenceId,
				sha256: sha,
				extension: "jpg",
			}),
		).toBe(`lembra/${referenceId}/${sha}.jpg`);
		expect(
			lembraPendingObjectKey({
				referenceId,
				uploadId,
				sha256: sha,
				extension: "jpg",
			}),
		).toBe(
			`uploads/pending/lembra/${referenceId}/${uploadId}/${sha}.jpg`,
		);
	});

	it("rejects invalid object identities", () => {
		expect(
			lembraReferenceObjectKey({
				referenceId: "not-a-uuid",
				sha256: sha,
				extension: "png",
			}),
		).toBeNull();
	});


	it("splits same-origin uploads into bounded chunks", () => {
		expect(lembraUploadChunkCount(24)).toBe(1);
		expect(lembraUploadChunkCount(LEMBRA_UPLOAD_CHUNK_BYTES)).toBe(1);
		expect(lembraUploadChunkCount(LEMBRA_UPLOAD_CHUNK_BYTES + 1)).toBe(2);
		expect(lembraUploadChunkCount(LEMBRA_MAX_BYTES)).toBe(6);
		expect(lembraUploadChunkCount(LEMBRA_MAX_BYTES + 1)).toBeNull();
	});

	it("builds upload chunk keys inside the pending Lembra namespace", () => {
		expect(
			lembraPendingChunkObjectKey({
				referenceId,
				uploadId,
				part: 0,
			}),
		).toBe(
			`uploads/pending/lembra/${referenceId}/${uploadId}/chunks/00`,
		);
		expect(
			lembraPendingChunkObjectKey({
				referenceId,
				uploadId,
				part: 5,
			}),
		).toBe(
			`uploads/pending/lembra/${referenceId}/${uploadId}/chunks/05`,
		);
		expect(
			lembraPendingChunkObjectKey({
				referenceId,
				uploadId,
				part: -1,
			}),
		).toBeNull();
		expect(
			lembraPendingChunkObjectKey({
				referenceId,
				uploadId,
				part: 6,
			}),
		).toBeNull();
	});

	it("accepts intended image MIME types inside the byte limit", () => {
		for (const mimeType of ["image/jpeg", "image/png", "image/webp"] as const) {
			expect(
				validLembraUploadIntent({ sha256: sha, mimeType, bytes: 2048 }),
			).toBe(true);
		}
		expect(
			validLembraUploadIntent({
				sha256: "bad",
				mimeType: "image/png",
				bytes: 2048,
			}),
		).toBe(false);
	});

	it("bounds human metadata", () => {
		expect(validLembraTitle(" Ruínas ")).toBe(true);
		expect(validLembraTitle("   ")).toBe(false);
		expect(validLembraTitle("x".repeat(121))).toBe(false);
		expect(validLembraDescription("x".repeat(320))).toBe(true);
		expect(validLembraDescription("x".repeat(321))).toBe(false);
	});
});
