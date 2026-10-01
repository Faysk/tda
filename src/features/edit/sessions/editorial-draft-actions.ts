"use server";

import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import {
	isExistingPublishedSessionCoverReference,
	isSessionCoverUuid,
} from "./session-cover-media";
import { getSessionCoverAssetStatusAction } from "./session-cover-media-actions";
import { authorizeSessionCampaignTarget } from "./session-campaign-access";
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

	const access = await authorizeSessionCampaignTarget(
		input.sessionId,
		EDIT_CAPABILITIES.contentEdit,
	);
	if (!access.ok) {
		return {
			ok: false as const,
			reason: access.reason,
			issues: [access.reason],
		};
	}

	const { campaignTechnicalSlug, profileId } = access.target;
	try {
		if (
			coverReference &&
			!isSessionCoverUuid(coverReference) &&
			!isExistingPublishedSessionCoverReference(
				coverReference,
				campaignTechnicalSlug,
			)
		) {
			return {
				ok: false as const,
				reason: "validation" as const,
				issues: ["cover_asset_unverified"] as const,
			};
		}

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
			profileId,
			input,
			campaignTechnicalSlug,
		);
		if (!result.ok) {
			const remote =
				result.reason === "conflict"
					? await readSessionEditorialDraft(
							input.sessionId,
							campaignTechnicalSlug,
						)
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
			campaignTechnicalSlug,
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
