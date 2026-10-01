"use server";

import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { getSessionCoverAssetStatusAction } from "./session-cover-media-actions";
import {
	isExistingPublishedSessionCoverReference,
	isSessionCoverUuid,
} from "./session-cover-media";
import {
	type SessionEditorialDraftInput,
	validateSessionEditorialDraftInput,
} from "./editorial-draft-model";
import {
	persistSessionEditorialDraft,
	readSessionEditorialDraft,
} from "./editorial-draft-repository";
import { resolveEditSessionCampaign } from "./repository";

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
	const issues = [...validateSessionEditorialDraftInput(input)];
	const coverReference = input.coverAssetId.trim();
	if (
		coverReference &&
		!isSessionCoverUuid(coverReference) &&
		!isExistingPublishedSessionCoverReference(coverReference)
	) {
		issues.push("cover_asset_unverified");
	}
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
		const sessionCampaign = await resolveEditSessionCampaign(input.sessionId);
		if (!sessionCampaign || sessionCampaign.lifecycle !== "active")
			return {
				ok: false as const,
				reason: "not_found" as const,
				issues: ["not_found"] as const,
			};
		const access = authorizeCampaignCapability(
			context,
			EDIT_CAPABILITIES.contentEdit,
			sessionCampaign.technicalSlug,
		);
		if (!access.ok)
			return {
				ok: false as const,
				reason: access.reason,
				issues: [access.reason],
			};

		if (coverReference && isSessionCoverUuid(coverReference)) {
			const cover = await getSessionCoverAssetStatusAction(
				input.sessionId,
				coverReference,
			);
			if (!cover.ok) {
				if (cover.reason === "dependency_unavailable")
					return {
						ok: false as const,
						reason: "dependency_unavailable" as const,
						issues: ["dependency_unavailable"] as const,
					};
				return {
					ok: false as const,
					reason: "validation" as const,
					issues: ["cover_asset_unverified"] as const,
				};
			}
		}

		const result = await persistSessionEditorialDraft(
			access.profileId,
			sessionCampaign.technicalSlug,
			input,
		);
		if (!result.ok) {
			const remote =
				result.reason === "conflict"
					? await readSessionEditorialDraft(input.sessionId, sessionCampaign.technicalSlug)
					: null;
			return {
				ok: false as const,
				reason: result.reason,
				issues: [result.reason],
				remote,
			};
		}

		const saved = await readSessionEditorialDraft(
			input.sessionId,
			sessionCampaign.technicalSlug,
		);
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
