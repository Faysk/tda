"use server";

import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { mutateTranscriptSegment } from "./mutation";
import { persistTranscriptMutation } from "./persistence";
import { readTranscriptSegment } from "./repository";

export type UpdateTranscriptSegmentActionInput = Readonly<{
	sessionId: string;
	segmentId: string;
	expectedRevision: number;
	text: string;
	speaker: string;
	reviewStatus: string;
}>;

export async function updateTranscriptSegmentAction(
	input: UpdateTranscriptSegmentActionInput,
) {
	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) {
		return {
			ok: false as const,
			reason: identity.reason,
			issues: [identity.reason],
		};
	}

	try {
		const result = await mutateTranscriptSegment(
			{
				authUserId: identity.authUserId,
				campaignSlug: CAMPAIGN_SLUG,
				sessionId: input.sessionId,
				segmentId: input.segmentId,
				expectedRevision: input.expectedRevision,
				text: input.text,
				speaker: input.speaker,
				reviewStatus: input.reviewStatus,
			},
			{
				resolveAccessContext: loadEditAccessContext,
				persist: persistTranscriptMutation,
			},
		);

		if (!result.ok) {
			return {
				ok: false as const,
				reason: result.reason,
				issues:
					result.reason === "validation"
						? result.issues
						: [result.reason],
			};
		}

		return {
			ok: true as const,
			revision: result.revision,
			segment: {
				text: result.segment.text,
				speaker: result.segment.speaker,
				reviewStatus: result.segment.reviewStatus,
			},
		};
	} catch {
		console.error("[edit] transcript update failed");
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
			issues: ["dependency_unavailable"] as const,
		};
	}
}


export type ReloadTranscriptSegmentActionInput = Readonly<{
	sessionId: string;
	segmentId: string;
}>;

const TRANSCRIPT_UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function reloadTranscriptSegmentAction(
	input: ReloadTranscriptSegmentActionInput,
) {
	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) {
		return {
			ok: false as const,
			reason: identity.reason,
			issues: [identity.reason],
		};
	}
	if (
		!TRANSCRIPT_UUID_PATTERN.test(input.sessionId) ||
		!TRANSCRIPT_UUID_PATTERN.test(input.segmentId)
	) {
		return {
			ok: false as const,
			reason: "validation" as const,
			issues: ["validation"] as const,
		};
	}

	try {
		const context = await loadEditAccessContext(identity.authUserId);
		if (!context) {
			return {
				ok: false as const,
				reason: "dependency_unavailable" as const,
				issues: ["dependency_unavailable"] as const,
			};
		}
		const access = authorizeCampaignCapability(
			context,
			EDIT_CAPABILITIES.transcriptRead,
			CAMPAIGN_SLUG,
		);
		if (!access.ok) {
			return {
				ok: false as const,
				reason: access.reason,
				issues: [access.reason],
			};
		}

		const segment = await readTranscriptSegment({
			campaignSlug: CAMPAIGN_SLUG,
			sessionId: input.sessionId,
			segmentId: input.segmentId,
		});
		if (!segment) {
			return {
				ok: false as const,
				reason: "not_found" as const,
				issues: ["not_found"] as const,
			};
		}

		return {
			ok: true as const,
			revision: segment.revision,
			segment: {
				text: segment.text,
				speaker:
					segment.characterName ||
					segment.speakerName ||
					segment.trackKey ||
					"Mesa",
				reviewStatus: segment.reviewStatus,
			},
		};
	} catch {
		console.error("[edit] transcript reconciliation reload failed");
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
			issues: ["dependency_unavailable"] as const,
		};
	}
}
