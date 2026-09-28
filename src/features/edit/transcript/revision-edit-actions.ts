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
	validateTranscriptRevisionEdits,
} from "./revision-edit-contract";
import { persistTranscriptRevisionEdits } from "./revision-edit-repository";

export async function saveTranscriptRevisionEditsAction(
	input: TranscriptRevisionEditInput,
) {
	const issues = validateTranscriptRevisionEdits(input);
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
			issues: [identity.reason],
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
				issues: [access.reason],
			};

		const result = await persistTranscriptRevisionEdits(access.profileId, input);
		if (!result.ok)
			return {
				ok: false as const,
				reason: result.reason,
				issues: [result.reason],
				currentRevisionId: result.currentRevisionId ?? null,
			};

		return {
			ok: true as const,
			status: result.status,
			revisionId: result.revisionId,
			revisionNumber: result.revisionNumber,
		};
	} catch {
		// Never log the request body: transcript text is private.
		console.error("[edit] transcript revision save failed");
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
			issues: ["dependency_unavailable"] as const,
		};
	}
}
