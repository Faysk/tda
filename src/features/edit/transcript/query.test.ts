import { describe, expect, it, vi } from "vitest";
import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "../access/policy";
import {
	queryTranscriptPage,
	type TranscriptQueryDependencies,
} from "./query";

const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const segmentId = "123e4567-e89b-42d3-a456-426614174001";

function accessContext(
	overrides: Partial<EditAccessContext> = {},
): EditAccessContext {
	return {
		authUserId: "auth-user",
		profileId: "profile-1",
		grants: [
			{
				action: EDIT_CAPABILITIES.transcriptRead,
				scopeType: "campaign",
				scopeId: "yuhara-main",
				status: "active",
				startsAt: "2026-01-01T00:00:00.000Z",
				endsAt: null,
			},
		],
		...overrides,
	};
}

function dependencies(
	overrides: Partial<TranscriptQueryDependencies> = {},
): TranscriptQueryDependencies {
	const readPage: TranscriptQueryDependencies["readPage"] = vi.fn(async () => ({
		segments: [
			{
				id: segmentId,
				sessionId,
				revision: 0,
				startMs: 1000,
				endMs: 2000,
				text: "Teste",
				speakerName: "Dandelion",
				characterName: "Dandelion",
				speakerRole: "player",
				trackKey: "track-1",
				reviewStatus: "pending" as const,
				sourceSegmentId: "source-1",
				sourceFileId: null,
				sourceChunkId: null,
				textChars: 5,
				textWords: 1,
			},
		],
		nextCursor: null,
	}));

	return {
		resolveAccessContext: vi.fn(async () => accessContext()),
		readPage,
		...overrides,
	};
}

describe("queryTranscriptPage", () => {
	it("rejects requests without a verified auth user", async () => {
		const deps = dependencies();
		const result = await queryTranscriptPage(
			{ authUserId: null, campaignSlug: "yuhara-main", sessionId },
			deps,
		);

		expect(result).toEqual({ ok: false, reason: "unauthenticated" });
		expect(deps.resolveAccessContext).not.toHaveBeenCalled();
		expect(deps.readPage).not.toHaveBeenCalled();
	});

	it("rejects an authenticated user without a resolved profile", async () => {
		const deps = dependencies({
			resolveAccessContext: vi.fn(async () =>
				accessContext({ profileId: null, grants: [] }),
			),
		});

		expect(
			await queryTranscriptPage(
				{ authUserId: "auth-user", campaignSlug: "yuhara-main", sessionId },
				deps,
			),
		).toEqual({ ok: false, reason: "profile_unresolved" });
		expect(deps.readPage).not.toHaveBeenCalled();
	});

	it("rejects a capability from the wrong campaign", async () => {
		const deps = dependencies({
			resolveAccessContext: vi.fn(async () =>
				accessContext({
					grants: [
						{
							action: EDIT_CAPABILITIES.transcriptRead,
							scopeType: "campaign",
							scopeId: "other-campaign",
							status: "active",
							startsAt: "2026-01-01T00:00:00.000Z",
							endsAt: null,
						},
					],
				}),
			),
		});

		expect(
			await queryTranscriptPage(
				{ authUserId: "auth-user", campaignSlug: "yuhara-main", sessionId },
				deps,
			),
		).toEqual({ ok: false, reason: "forbidden" });
		expect(deps.readPage).not.toHaveBeenCalled();
	});

	it("returns a narrow transcript page after authorization", async () => {
		const deps = dependencies();
		const result = await queryTranscriptPage(
			{ authUserId: "auth-user", campaignSlug: "yuhara-main", sessionId },
			deps,
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.segments[0]?.revision).toBe(0);
		}
		expect(deps.readPage).toHaveBeenCalledWith({
			campaignSlug: "yuhara-main",
			sessionId,
			limit: 100,
			cursor: null,
		});
	});

	it("does not reveal a session outside the authorized campaign", async () => {
		const deps = dependencies({ readPage: vi.fn(async () => null) });

		expect(
			await queryTranscriptPage(
				{ authUserId: "auth-user", campaignSlug: "yuhara-main", sessionId },
				deps,
		).toEqual({ ok: false, reason: "not_found" });
	});

	it("reports a disabled edit data dependency distinctly", async () => {
		const deps = dependencies({
			resolveAccessContext: vi.fn(async () => null),
		});

		expect(
			await queryTranscriptPage(
				{ authUserId: "auth-user", campaignSlug: "yuhara-main", sessionId },
				deps,
			),
		).toEqual({ ok: false, reason: "dependency_unavailable" });
	});

	it("rejects malformed ids and unsafe page sizes before querying", async () => {
		const deps = dependencies();
		const result = await queryTranscriptPage(
			{
				authUserId: "auth-user",
				campaignSlug: "yuhara-main",
				sessionId: "not-a-uuid",
				limit: 5000,
			},
			deps,
		);

		expect(result).toEqual({ ok: false, reason: "validation" });
		expect(deps.resolveAccessContext).not.toHaveBeenCalled();
	});
});
