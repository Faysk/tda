import { describe, expect, it } from "vitest";
import {
	lembraPendingObjectKey,
	lembraReferenceObjectKey,
	validLembraDescription,
	validLembraTitle,
	validLembraUploadIntent,
} from "./model";

const referenceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const uploadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sha = "c".repeat(64);

describe("Lembra model", () => {
	it("builds scoped immutable and pending object keys", () => {
		expect(
			lembraReferenceObjectKey({
				campaignSlug: "yuhara-main",
				referenceId,
				sha256: sha,
				extension: "jpg",
			}),
		).toBe(`campaigns/yuhara-main/lembra/${referenceId}/${sha}.jpg`);
		expect(
			lembraPendingObjectKey({
				campaignSlug: "yuhara-main",
				referenceId,
				uploadId,
				sha256: sha,
				extension: "jpg",
			}),
		).toBe(
			`uploads/pending/lembra/yuhara-main/${referenceId}/${uploadId}/${sha}.jpg`,
		);
	});

	it("rejects invalid path identities", () => {
		expect(
			lembraReferenceObjectKey({
				campaignSlug: "../other",
				referenceId,
				sha256: sha,
				extension: "png",
			}),
		).toBeNull();
		expect(
			lembraReferenceObjectKey({
				campaignSlug: "yuhara-main",
				referenceId: "not-a-uuid",
				sha256: sha,
				extension: "png",
			}),
		).toBeNull();
	});

	it("accepts the three intended image MIME types within size bounds", () => {
		for (const mimeType of ["image/jpeg", "image/png", "image/webp"] as const) {
			expect(validLembraUploadIntent({ sha256: sha, mimeType, bytes: 2048 })).toBe(true);
		}
		expect(validLembraUploadIntent({ sha256: "bad", mimeType: "image/png", bytes: 2048 })).toBe(false);
	});

	it("bounds human metadata", () => {
		expect(validLembraTitle(" Ruínas ")).toBe(true);
		expect(validLembraTitle("   ")).toBe(false);
		expect(validLembraTitle("x".repeat(121))).toBe(false);
		expect(validLembraDescription("x".repeat(320))).toBe(true);
		expect(validLembraDescription("x".repeat(321))).toBe(false);
	});
});
