"use server";

import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	type TranscriptEditRequest,
	type TranscriptEditSaveResult,
	validateTranscriptEditRequest,
} from "./edit-model";
import { persistTranscriptRevisionEdits } from "./edit-repository";
import { readTranscriptSnapshot } from "./repository";

export async function saveTranscriptRevisionEditsAction(
	input: TranscriptEditRequest,
): Promise<TranscriptEditSaveResult> {
	const issues = validateTranscriptEditRequest(input);
	if (issues.length) {
		return {
			ok: false as const,
			reason: "validation" as const,
			issues,
		};
	}

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

		const result = await persistTranscriptRevisionEdits({
			authUserId: identity.authUserId,
			actorProfileId: access.profileId,
			campaignSlug: CAMPAIGN_SLUG,
			request: input,
		});
		if (!result.ok) {
			return {
				ok: false as const,
				reason: result.reason,
				issues: [result.reason],
				currentRevisionId: result.currentRevisionId ?? null,
				currentRevisionNumber: result.currentRevisionNumber ?? null,
			};
		}

		const current = await readTranscriptSnapshot({
			campaignSlug: CAMPAIGN_SLUG,
			sessionId: input.sessionId,
		});
		if (
			current?.source !== "current_revision" ||
			current.revisionId !== result.revisionId ||
			current.revisionNumber !== result.revisionNumber
		) {
			return {
				ok: false as const,
				reason: "dependency_unavailable" as const,
				issues: ["readback_mismatch"] as const,
			};
		}

		return {
			ok: true as const,
			status: result.status,
			revisionId: result.revisionId,
			revisionNumber: result.revisionNumber,
		};
	} catch {
		console.error("[edit] transcript revision save failed");
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
			issues: ["dependency_unavailable"] as const,
		};
	}
}
