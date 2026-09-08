"use server";

import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { mutateTranscriptSegment } from "./mutation";
import { persistTranscriptMutation } from "./persistence";

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
				text: input.text.trim(),
				speaker: input.speaker.trim(),
				reviewStatus: input.reviewStatus,
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
