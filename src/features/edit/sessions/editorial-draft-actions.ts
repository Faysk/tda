"use server";

import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	type SessionEditorialDraftInput,
	validateSessionEditorialDraftInput,
} from "./editorial-draft-model";
import {
	persistSessionEditorialDraft,
	readSessionEditorialDraft,
} from "./editorial-draft-repository";

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function saveSessionEditorialDraftAction(
	input: SessionEditorialDraftInput,
) {
	if (
		!UUID.test(input.sessionId) ||
		!UUID.test(input.baseTranscriptRevisionId)
	) {
		return {
			ok: false as const,
			reason: "validation" as const,
			issues: ["identity"] as const,
		};
	}
	const issues = validateSessionEditorialDraftInput(input);
	if (issues.length) {
		return { ok: false as const, reason: "validation" as const, issues };
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

		const result = await persistSessionEditorialDraft(access.profileId, input);
		if (!result.ok) {
			const remote =
				result.reason === "conflict"
					? await readSessionEditorialDraft(input.sessionId)
					: null;
			return {
				ok: false as const,
				reason: result.reason,
				issues: [result.reason],
				remote,
			};
		}

		const saved = await readSessionEditorialDraft(input.sessionId);
		if (!saved || saved.revision !== result.revision)
			return {
				ok: false as const,
				reason: "dependency_unavailable" as const,
				issues: ["dependency_unavailable"] as const,
			};
		return { ok: true as const, draft: saved };
	} catch {
		console.error("[edit] session editorial draft save failed");
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
			issues: ["dependency_unavailable"] as const,
		};
	}
}
