"use server";

import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { unsafeUpdateTranscriptSegment } from "./unsafe-mutation";

export type UpdateTranscriptSegmentActionInput = Readonly<{
	sessionId: string;
	segmentId: string;
	text: string;
	speaker: string;
	reviewStatus: string;
}>;

export async function updateTranscriptSegmentAction(
	input: UpdateTranscriptSegmentActionInput,
) {
	const access = await authorizeCampaignCapabilityServer({ action: EDIT_CAPABILITIES.contentEdit, campaignSlug: CAMPAIGN_SLUG });
	if (!access.ok) return { ok: false as const, issues: [access.reason] };
	try {
		return await unsafeUpdateTranscriptSegment({
			sessionId: input.sessionId,
			segmentId: input.segmentId,
			edit: {
				text: input.text,
				speaker: input.speaker,
				reviewStatus: input.reviewStatus,
			},
		});
	} catch {
		console.error("[edit] transcript update failed");
		return { ok: false as const, issues: ["update_failed"] as const };
	}
}
