import { describe, expect, it } from "vitest";
import {
	SESSION_COVER_MEDIA_MAX_BYTES,
	SESSION_COVER_MEDIA_MAX_UPLOAD_CHUNKS,
	isExistingPublishedSessionCoverReference,
	isSessionCoverIntent,
	sessionCoverObjectKey,
	sessionCoverPendingChunkObjectKey,
	sessionCoverPreviewUrl,
	sessionCoverUploadChunkCount,
} from "./session-cover-media";

const sessionId = "11111111-1111-4111-8111-111111111111";
const uploadId = "22222222-2222-4222-8222-222222222222";
const sha256 = "a".repeat(64);

describe("session cover media contract", () => {
	it("derives immutable canonical keys inside the owning session scope", () => {
		expect(
			sessionCoverObjectKey({
				campaignSlug: "yuhara-main",
				sessionId,
				sha256,
				extension: "webp",
			}),
		).toBe(
			"campaigns/yuhara-main/sessions/" +
				sessionId +
				"/cover/" +
				sha256 +
				".webp",
		);
	});

	it("derives bounded pending chunk keys", () => {
		expect(
			sessionCoverPendingChunkObjectKey({
				campaignSlug: "yuhara-main",
				sessionId,
				uploadId,
				sha256,
				part: 0,
			}),
		).toContain(`/${uploadId}/${sha256}.part-00`);
		expect(
			sessionCoverPendingChunkObjectKey({
				campaignSlug: "yuhara-main",
				sessionId,
				uploadId,
				sha256,
				part: SESSION_COVER_MEDIA_MAX_UPLOAD_CHUNKS,
			}),
		).toBeNull();
	});

	it("uses the shared media upload budget", () => {
		expect(sessionCoverUploadChunkCount(24)).toBe(1);
		expect(sessionCoverUploadChunkCount(SESSION_COVER_MEDIA_MAX_BYTES)).toBe(
			SESSION_COVER_MEDIA_MAX_UPLOAD_CHUNKS,
		);
		expect(
			sessionCoverUploadChunkCount(SESSION_COVER_MEDIA_MAX_BYTES + 1),
		).toBeNull();
	});

	it("validates intent shape without trusting browser MIME as final truth", () => {
		expect(
			isSessionCoverIntent({
				sha256,
				mimeType: "image/png",
				bytes: 1024,
			}),
		).toBe(true);
		expect(
			isSessionCoverIntent({
				sha256,
				mimeType: "image/jpeg",
				bytes: 1024,
			}),
		).toBe(false);
	});

	it("accepts only governed existing public cover references", () => {
		expect(
			isExistingPublishedSessionCoverReference(
				"https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/abc/cover.webp",
			),
		).toBe(true);
		expect(
			isExistingPublishedSessionCoverReference(
				"https://dmrqnbdvbkfqzctcerbx.supabase.co/storage/v1/object/public/session-images/legacy.webp",
			),
		).toBe(true);
		expect(
			isExistingPublishedSessionCoverReference("/assets/sessions/legacy.webp"),
		).toBe(true);
		expect(
			isExistingPublishedSessionCoverReference(
				"https://dmrqnbdvbkfqzctcerbx.supabase.co/storage/v1/object/public/session-images/legacy.webp",
				"campaign-b",
			),
		).toBe(false);
		expect(
			isExistingPublishedSessionCoverReference(
				"https://media.dnd.faysk.dev/campaigns/other/sessions/abc.webp",
			),
		).toBe(true);
		expect(
			isExistingPublishedSessionCoverReference(
				"https://media.dnd.faysk.dev/campaigns/other/sessions/abc.webp",
				"other",
			),
		).toBe(true);
		expect(
			isExistingPublishedSessionCoverReference(
				"https://media.dnd.faysk.dev/campaigns/other/sessions/abc.webp",
				"yuhara-main",
			),
		).toBe(false);
		expect(
			isExistingPublishedSessionCoverReference("https://evil.example/cover.webp"),
		).toBe(false);
		expect(
			isExistingPublishedSessionCoverReference(
				"https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/abc.webp?token=secret",
			),
		).toBe(false);
		expect(
			isExistingPublishedSessionCoverReference(
				"https://dmrqnbdvbkfqzctcerbx.supabase.co/storage/v1/object/public/session-images/legacy.webp?token=secret",
			),
		).toBe(false);
	});


	it("binds private preview URL to both session and asset", () => {
		expect(sessionCoverPreviewUrl(sessionId, uploadId)).toBe(
			`/api/edit/session-cover/${sessionId}/${uploadId}`,
		);
		expect(sessionCoverPreviewUrl("wrong", uploadId)).toBeUndefined();
	});
});
