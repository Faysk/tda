"use server";

import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	prepareTranscriptRevisionEditChanges,
	type TranscriptRevisionEditChange,
} from "./revision-edit-model";
import { persistTranscriptRevisionEdit } from "./revision-edit-persistence";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SaveTranscriptRevisionEditActionInput = Readonly<{
	sessionId: string;
	expectedCurrentTranscriptRevisionId: string;
	operationId: string;
	changes: readonly TranscriptRevisionEditChange[];
}>;

export async function saveTranscriptRevisionEditAction(
	input: SaveTranscriptRevisionEditActionInput,
) {
	const prepared = prepareTranscriptRevisionEditChanges(input.changes);
	const identityValid =
		UUID_PATTERN.test(input.sessionId) &&
		UUID_PATTERN.test(input.expectedCurrentTranscriptRevisionId) &&
		UUID_PATTERN.test(input.operationId);
	if (!identityValid || !prepared.ok) {
		return {
			ok: false as const,
			reason: "validation" as const,
			issues: prepared.ok ? (["identity_invalid"] as const) : prepared.issues,
		};
	}

	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) {
		return {
			ok: false as const,
			reason: identity.reason,
			issues: [identity.reason],
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
			EDIT_CAPABILITIES.contentEdit,
			CAMPAIGN_SLUG,
		);
		if (!access.ok) {
			return {
				ok: false as const,
				reason: access.reason,
				issues: [access.reason],
			};
		}

		const result = await persistTranscriptRevisionEdit({
			actorProfileId: access.profileId,
			campaignSlug: CAMPAIGN_SLUG,
			sessionId: input.sessionId,
			expectedCurrentRevisionId: input.expectedCurrentTranscriptRevisionId,
			operationId: input.operationId,
			changes: prepared.value.changes,
		});

		switch (result.status) {
			case "updated":
			case "replay":
			case "no_change":
				return {
					ok: true as const,
					status: result.status,
					revisionId: result.revisionId,
					revisionNumber: result.revisionNumber,
				};
			case "stale_current":
				return {
					ok: false as const,
					reason: "stale_current" as const,
					currentRevisionId: result.currentRevisionId,
					issues: ["stale_current"] as const,
				};
			default:
				return {
					ok: false as const,
					reason: result.status,
					issues: [result.status],
				};
		}
	} catch {
		console.error("[edit] transcript revision save failed");
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
			issues: ["dependency_unavailable"] as const,
		};
	}
}
