import { describe, expect, it, vi } from "vitest";
import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "@/features/edit/access/policy";
import {
	mutateTranscriptSegment,
	type TranscriptMutationDependencies,
} from "./mutation";

const segmentId = "123e4567-e89b-42d3-a456-426614174001";

function context(
	action = EDIT_CAPABILITIES.contentEdit,
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
	return {
		resolveAccessContext: vi.fn(async () => context()),
		persist: vi.fn(async () => ({ status: "updated", revision: 4 })),
		...overrides,
	};
}

const request = {
	authUserId: "auth-user",
	campaignSlug: "yuhara-main",
	segmentId,
	expectedRevision: 3,
	text: " Texto corrigido ",
	speaker: " Dandelion ",
	reviewStatus: "approved",
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

	it("validates the revision and edit payload before authorization", async () => {
		const deps = dependencies();
		const result = await mutateTranscriptSegment(
			{
				...request,
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
				"expected_revision_invalid",
				"text_required",
				"review_status_invalid",
			],
		});
		expect(deps.resolveAccessContext).not.toHaveBeenCalled();
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

	it("passes only server-derived invariants to persistence", async () => {
		const deps = dependencies();
		const result = await mutateTranscriptSegment(request, deps);

		expect(result).toEqual({ ok: true, revision: 4 });
		expect(deps.persist).toHaveBeenCalledWith({
			actorProfileId: "profile-1",
			campaignSlug: "yuhara-main",
			segmentId,
			expectedRevision: 3,
			edit: {
				text: "Texto corrigido",
				speaker: "Dandelion",
				reviewStatus: "approved",
				needsReview: false,
				textChars: 15,
				textWords: 2,
			},
		});
	});

	it("surfaces optimistic concurrency conflicts", async () => {
		const deps = dependencies({
			persist: vi.fn(async () => ({ status: "conflict" })),
		});

		expect(await mutateTranscriptSegment(request, deps)).toEqual({
			ok: false,
			reason: "conflict",
		});
	});

	it("does not expose cross-campaign resource existence", async () => {
		const deps = dependencies({
			persist: vi.fn(async () => ({ status: "not_found" })),
		});

		expect(await mutateTranscriptSegment(request, deps)).toEqual({
			ok: false,
			reason: "not_found",
		});
	});
});
