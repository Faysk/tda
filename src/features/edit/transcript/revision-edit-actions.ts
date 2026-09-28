"use server";

import { getVerifiedServerIdentity } from "@/features/auth/server";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	prepareTranscriptRevisionEdits,
	type TranscriptRevisionEditPatch,
} from "./revision-edit-model";
import { persistTranscriptRevisionEdit } from "./revision-edit-persistence";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SaveTranscriptRevisionActionInput = Readonly<{
	sessionId: string;
	expectedCurrentRevisionId: string;
	operationId: string;
	edits: readonly TranscriptRevisionEditPatch[];
}>;

export async function saveTranscriptRevisionAction(
	input: SaveTranscriptRevisionActionInput,
) {
	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) {
		return { ok: false as const, reason: identity.reason };
	}

	if (
		!UUID_PATTERN.test(input.sessionId) ||
		!UUID_PATTERN.test(input.expectedCurrentRevisionId) ||
		!UUID_PATTERN.test(input.operationId)
	) {
		return { ok: false as const, reason: "validation" as const };
	}

	const prepared = prepareTranscriptRevisionEdits(input.edits);
	if (!prepared.ok) {
		return {
			ok: false as const,
			reason: "validation" as const,
			issues: prepared.issues,
		};
	}

	try {
		const context = await loadEditAccessContext(identity.authUserId);
		if (!context) {
			return { ok: false as const, reason: "dependency_unavailable" as const };
		}
		const access = authorizeCampaignCapability(
			context,
			EDIT_CAPABILITIES.contentEdit,
			CAMPAIGN_SLUG,
		);
		if (!access.ok) return { ok: false as const, reason: access.reason };

		const result = await persistTranscriptRevisionEdit({
			actorProfileId: access.profileId,
			campaignSlug: CAMPAIGN_SLUG,
			sessionId: input.sessionId,
			expectedCurrentRevisionId: input.expectedCurrentRevisionId,
			operationId: input.operationId,
			edits: prepared.patches,
		});

		if (result.status === "updated" || result.status === "no_change") {
			return {
				ok: true as const,
				status: result.status,
				revisionId: result.revisionId,
				revisionNumber: result.revisionNumber,
				edits: prepared.patches,
			};
		}
		return { ok: false as const, reason: result.status };
	} catch {
		console.error("[edit] immutable transcript revision update failed");
		return { ok: false as const, reason: "dependency_unavailable" as const };
	}
}
