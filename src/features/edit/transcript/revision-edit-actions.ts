"use server";

import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	type TranscriptRevisionEditInput,
	validateTranscriptRevisionEditInput,
} from "./revision-edit-model";
import { persistTranscriptRevisionEdit } from "./revision-edit-persistence";
import { readTranscriptSnapshot } from "./repository";

export async function saveTranscriptRevisionEditAction(
	input: TranscriptRevisionEditInput,
) {
	const issues = validateTranscriptRevisionEditInput(input);
	if (issues.length)
		return {
			ok: false as const,
			reason: "validation" as const,
			issues,
		};

	const identity = await getVerifiedServerIdentity();
	if (!identity.ok)
		return {
			ok: false as const,
			reason: identity.reason,
			issues: [identity.reason] as const,
		};

	try {
		const context = await loadEditAccessContext(identity.authUserId);
		if (!context)
			return {
				ok: false as const,
				reason: "dependency_unavailable" as const,
				issues: ["dependency_unavailable"] as const,
			};
		const access = authorizeCampaignCapability(
			context,
			EDIT_CAPABILITIES.contentEdit,
			CAMPAIGN_SLUG,
		);
		if (!access.ok)
			return {
				ok: false as const,
				reason: access.reason,
				issues: [access.reason] as const,
			};

		const result = await persistTranscriptRevisionEdit({
			authUserId: identity.authUserId,
			actorProfileId: access.profileId,
			campaignSlug: CAMPAIGN_SLUG,
			sessionId: input.sessionId,
			expectedCurrentTranscriptRevisionId:
				input.expectedCurrentTranscriptRevisionId,
			operationId: input.operationId,
			patches: input.patches,
		});

		if (result.status === "saved")
			return {
				ok: true as const,
				revisionId: result.revisionId,
				revisionNumber: result.revisionNumber,
				parentRevisionId: result.parentRevisionId,
				changedSegments: result.changedSegments,
				replayed: result.replayed,
				unchanged: result.unchanged,
			};

		if (result.status === "stale_current") {
			const remote = await readTranscriptSnapshot({
				campaignSlug: CAMPAIGN_SLUG,
				sessionId: input.sessionId,
			});
			return {
				ok: false as const,
				reason: "stale_current" as const,
				issues: ["stale_current"] as const,
				remote:
					remote?.source === "current_revision" &&
					remote.revisionId &&
					remote.revisionNumber
						? remote
						: null,
			};
		}

		return {
			ok: false as const,
			reason: result.status,
			issues: [result.status] as const,
		};
	} catch {
		console.error("[edit] private transcript revision save failed");
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
			issues: ["dependency_unavailable"] as const,
		};
	}
}
