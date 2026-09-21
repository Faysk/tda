import { describe, expect, it, vi } from "vitest";
import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "../access/policy";
import {
	mutateTranscriptSegment,
	type TranscriptMutationDependencies,
} from "./mutation";

const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const segmentId = "123e4567-e89b-42d3-a456-426614174001";

function context(
	action: string = EDIT_CAPABILITIES.contentEdit,
	overrides: Partial<EditAccessContext> = {},
): EditAccessContext {
	return {
		authUserId: "auth-user",
		profileId: "profile-1",
		grants: [
			{
				action,
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
	overrides: Partial<TranscriptMutationDependencies> = {},
): TranscriptMutationDependencies {
	const persist: TranscriptMutationDependencies["persist"] = vi.fn(async () => ({
		status: "updated" as const,
		revision: 4,
	}));

	return {
		resolveAccessContext: vi.fn(async () => context()),
		persist,
		...overrides,
	};
}

const request = {
	authUserId: "auth-user",
	campaignSlug: "yuhara-main",
	sessionId,
	segmentId,
	expectedRevision: 3,
	text: " Texto corrigido ",
	speaker: " Dandelion ",
	reviewStatus: "approved",
} as const;

const approvedSnapshot = {
	text: "Texto corrigido",
	speaker: "Dandelion",
	reviewStatus: "approved",
	needsReview: false,
	textChars: 15,
	textWords: 2,
} as const;

describe("mutateTranscriptSegment", () => {
	it("requires authentication", async () => {
		const deps = dependencies();
		const result = await mutateTranscriptSegment(
			{ ...request, authUserId: null },
			deps,
		);

		expect(result).toEqual({ ok: false, reason: "unauthenticated" });
		expect(deps.resolveAccessContext).not.toHaveBeenCalled();
		expect(deps.persist).not.toHaveBeenCalled();
	});

	it("validates session, revision and edit payload before authorization", async () => {
		const deps = dependencies();
		const result = await mutateTranscriptSegment(
			{
				...request,
				sessionId: "wrong-session",
				expectedRevision: -1,
				text: " ",
				reviewStatus: "wat",
			},
			deps,
		);

		expect(result).toEqual({
			ok: false,
			reason: "validation",
			issues: [
				"session_id_invalid",
				"expected_revision_invalid",
				"text_required",
				"review_status_invalid",
			],
		});
		expect(deps.resolveAccessContext).not.toHaveBeenCalled();
		expect(deps.persist).not.toHaveBeenCalled();
	});

	it("does not allow transcript read capability to write", async () => {
		const deps = dependencies({
			resolveAccessContext: vi.fn(async () =>
				context(EDIT_CAPABILITIES.transcriptRead),
			),
		});

		expect(await mutateTranscriptSegment(request, deps)).toEqual({
			ok: false,
			reason: "forbidden",
		});
		expect(deps.persist).not.toHaveBeenCalled();
	});

	it("passes session-bound server invariants to persistence and returns the confirmed canonical snapshot", async () => {
		const deps = dependencies();
		const result = await mutateTranscriptSegment(request, deps);

		expect(result).toEqual({
			ok: true,
			revision: 4,
			segment: approvedSnapshot,
		});
		expect(deps.persist).toHaveBeenCalledWith({
			actorProfileId: "profile-1",
			campaignSlug: "yuhara-main",
			expectedSessionId: sessionId,
			segmentId,
			expectedRevision: 3,
			edit: approvedSnapshot,
		});
	});

	it("returns the canonical persisted state for legacy review aliases", async () => {
		const deps = dependencies();
		const result = await mutateTranscriptSegment(
			{
				...request,
				text: "  Texto legado  ",
				speaker: "  Sense  ",
				reviewStatus: "unreviewed",
			},
			deps,
		);

		expect(deps.persist).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedSessionId: sessionId,
				edit: {
					text: "Texto legado",
					speaker: "Sense",
					reviewStatus: "pending",
					needsReview: true,
					textChars: 12,
					textWords: 2,
				},
			}),
		);
		expect(result).toEqual({
			ok: true,
			revision: 4,
			segment: {
				text: "Texto legado",
				speaker: "Sense",
				reviewStatus: "pending",
				needsReview: true,
				textChars: 12,
				textWords: 2,
			},
		});
	});

	it("surfaces optimistic concurrency conflicts without fabricating a snapshot", async () => {
		const deps = dependencies({
			persist: vi.fn(async () => ({ status: "conflict" as const })),
		});

		expect(await mutateTranscriptSegment(request, deps)).toEqual({
			ok: false,
			reason: "conflict",
		});
	});

	it("keeps session/segment mismatch opaque as not_found", async () => {
		const deps = dependencies({
			persist: vi.fn(async () => ({ status: "not_found" as const })),
		});

		expect(await mutateTranscriptSegment(request, deps)).toEqual({
			ok: false,
			reason: "not_found",
		});
	});
});
