"use server";

import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	type LegacyTranscriptPrepareRequest,
	type LegacyTranscriptPrepareResult,
	validateLegacyTranscriptPrepareRequest,
} from "./legacy-prepare-model";
import { persistLegacyTranscriptPreparation } from "./legacy-prepare-repository";
import { readTranscriptSnapshot } from "./repository";

export async function prepareLegacyTranscriptAction(
	input: LegacyTranscriptPrepareRequest,
): Promise<LegacyTranscriptPrepareResult> {
	const issues = validateLegacyTranscriptPrepareRequest(input);
	if (issues.length)
		return { ok: false, reason: "validation", issues };

	const identity = await getVerifiedServerIdentity();
	if (!identity.ok)
		return {
			ok: false,
			reason: identity.reason,
			issues: [identity.reason],
		};

	try {
		const context = await loadEditAccessContext(identity.authUserId);
		if (!context)
			return {
				ok: false,
				reason: "dependency_unavailable",
				issues: ["dependency_unavailable"],
			};

		const access = authorizeCampaignCapability(
			context,
			EDIT_CAPABILITIES.contentEdit,
			CAMPAIGN_SLUG,
		);
		if (!access.ok)
			return {
				ok: false,
				reason: access.reason,
				issues: [access.reason],
			};

		const result = await persistLegacyTranscriptPreparation({
			authUserId: identity.authUserId,
			actorProfileId: access.profileId,
			campaignSlug: CAMPAIGN_SLUG,
			request: input,
		});
		if (!result.ok) return result;

		const current = await readTranscriptSnapshot({
			campaignSlug: CAMPAIGN_SLUG,
			sessionId: input.sessionId,
		});
		if (
			current?.source !== "current_revision" ||
			!current.revisionId ||
			!current.revisionNumber
		) {
			return {
				ok: false,
				reason: "dependency_unavailable",
				issues: ["readback_mismatch"],
			};
		}

		return {
			...result,
			revisionId: current.revisionId,
			revisionNumber: current.revisionNumber,
		};
	} catch {
		console.error("[edit] legacy transcript preparation failed");
		return {
			ok: false,
			reason: "dependency_unavailable",
			issues: ["dependency_unavailable"],
		};
	}
}
