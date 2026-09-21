import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	identity: vi.fn(),
	loadAccess: vi.fn(),
	persist: vi.fn(),
	readSegment: vi.fn(),
}));

vi.mock("@/features/auth/server", () => ({
	getVerifiedServerIdentity: mocks.identity,
}));
vi.mock("@/features/edit/access/repository", () => ({
	loadEditAccessContext: mocks.loadAccess,
}));
vi.mock("@/features/sessions/model", () => ({ CAMPAIGN_SLUG: "yuhara-main" }));
vi.mock("../edit/transcript/persistence", () => ({
	persistTranscriptMutation: mocks.persist,
}));
vi.mock("../edit/transcript/repository", () => ({
	readTranscriptSegment: mocks.readSegment,
}));

import {
	reloadTranscriptSegmentAction,
	updateTranscriptSegmentAction,
} from "../edit/transcript/actions";

const SEGMENT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const input = {
	sessionId: SESSION_ID,
	segmentId: SEGMENT_ID,
	expectedRevision: 7,
	text: " synthetic ",
	speaker: " Mesa ",
	reviewStatus: "approved",
} as const;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.identity.mockResolvedValue({ ok: true, authUserId: "verified" });
	mocks.loadAccess.mockResolvedValue({
		authUserId: "verified",
		profileId: "verified-profile",
		grants: [
			{
				action: "campaign.content.edit",
				scopeType: "campaign",
				scopeId: "yuhara-main",
				status: "active",
				startsAt: "2020-01-01T00:00:00.000Z",
				endsAt: null,
			},
			{
				action: "campaign.transcript.read",
				scopeType: "campaign",
				scopeId: "yuhara-main",
				status: "active",
				startsAt: "2020-01-01T00:00:00.000Z",
				endsAt: null,
			},
		],
	});
	mocks.persist.mockResolvedValue({ status: "updated", revision: 8 });
	mocks.readSegment.mockResolvedValue({
		id: SEGMENT_ID,
		sessionId: SESSION_ID,
		revision: 9,
		startMs: 1000,
		endMs: 2000,
		text: "Texto mais novo",
		speakerName: "Mesa",
		characterName: "Sense",
		speakerRole: "player",
		trackKey: "track-1",
		reviewStatus: "needs_review",
		sourceSegmentId: "source-1",
		sourceFileId: null,
		sourceChunkId: null,
		textChars: 15,
		textWords: 3,
	});
});

describe("administrative operation entry point", () => {
	it.each(["unauthenticated", "dependency_unavailable"])(
		"never invokes persistence when identity is %s",
		async (reason) => {
			mocks.identity.mockResolvedValue({ ok: false, reason });
			const result = await updateTranscriptSegmentAction(input);
			expect(result.ok).toBe(false);
			expect(mocks.loadAccess).not.toHaveBeenCalled();
			expect(mocks.persist).not.toHaveBeenCalled();
		},
	);

	it("never invokes persistence when the verified account is forbidden", async () => {
		mocks.loadAccess.mockResolvedValue({
			authUserId: "verified",
			profileId: "verified-profile",
			grants: [],
		});
		const result = await updateTranscriptSegmentAction(input);
		expect(result).toMatchObject({ ok: false, reason: "forbidden" });
		expect(mocks.persist).not.toHaveBeenCalled();
	});

	it("persists the original revision through the canonical mutation boundary", async () => {
		const result = await updateTranscriptSegmentAction(input);
		expect(mocks.loadAccess).toHaveBeenCalledWith("verified");
		expect(mocks.persist).toHaveBeenCalledWith({
			actorProfileId: "verified-profile",
			campaignSlug: "yuhara-main",
			expectedSessionId: SESSION_ID,
			segmentId: SEGMENT_ID,
			expectedRevision: 7,
			edit: {
				text: "synthetic",
				speaker: "Mesa",
				reviewStatus: "approved",
				needsReview: false,
				textChars: 9,
				textWords: 1,
			},
		});
		expect(result).toEqual({
			ok: true,
			revision: 8,
			segment: {
				text: "synthetic",
				speaker: "Mesa",
				reviewStatus: "approved",
			},
		});
	});

	it("surfaces an optimistic concurrency conflict without retrying", async () => {
		mocks.persist.mockResolvedValue({ status: "conflict" });
		const result = await updateTranscriptSegmentAction(input);
		expect(result).toMatchObject({
			ok: false,
			reason: "conflict",
			issues: ["conflict"],
		});
		expect(mocks.persist).toHaveBeenCalledTimes(1);
	});
});


describe("transcript conflict reconciliation reload", () => {
	it("validates exact session and segment ids before reading", async () => {
		const result = await reloadTranscriptSegmentAction({
			sessionId: "not-a-session",
			segmentId: SEGMENT_ID,
		});
		expect(result).toEqual({
			ok: false,
			reason: "validation",
			issues: ["validation"],
		});
		expect(mocks.loadAccess).not.toHaveBeenCalled();
		expect(mocks.readSegment).not.toHaveBeenCalled();
	});

	it("authorizes transcript read before resolving the current segment", async () => {
		mocks.loadAccess.mockResolvedValue({
			authUserId: "verified",
			profileId: "verified-profile",
			grants: [],
		});
		const result = await reloadTranscriptSegmentAction({
			sessionId: SESSION_ID,
			segmentId: SEGMENT_ID,
		});
		expect(result).toMatchObject({ ok: false, reason: "forbidden" });
		expect(mocks.readSegment).not.toHaveBeenCalled();
	});

	it("returns the exact current revision and canonical display draft", async () => {
		const result = await reloadTranscriptSegmentAction({
			sessionId: SESSION_ID,
			segmentId: SEGMENT_ID,
		});
		expect(mocks.readSegment).toHaveBeenCalledWith({
			campaignSlug: "yuhara-main",
			sessionId: SESSION_ID,
			segmentId: SEGMENT_ID,
		});
		expect(result).toEqual({
			ok: true,
			revision: 9,
			segment: {
				text: "Texto mais novo",
				speaker: "Sense",
				reviewStatus: "needs_review",
			},
		});
	});

	it("keeps missing segments opaque after authorization", async () => {
		mocks.readSegment.mockResolvedValue(null);
		expect(
			await reloadTranscriptSegmentAction({
				sessionId: SESSION_ID,
				segmentId: SEGMENT_ID,
			}),
		).toEqual({
			ok: false,
			reason: "not_found",
			issues: ["not_found"],
		});
	});
});
