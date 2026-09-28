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
} from "./revision-edit-contract";
import { persistTranscriptRevisionEdit } from "./revision-edit-persistence";
import { readTranscriptSnapshot } from "./repository";

async function editIdentity() {
	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) return { ok: false as const, reason: identity.reason };
	const context = await loadEditAccessContext(identity.authUserId);
	if (!context) return { ok: false as const, reason: "dependency_unavailable" as const };
	const access = authorizeCampaignCapability(
		context,
		EDIT_CAPABILITIES.contentEdit,
		CAMPAIGN_SLUG,
	);
	if (!access.ok) return { ok: false as const, reason: access.reason };
	return {
		ok: true as const,
		authUserId: identity.authUserId,
		profileId: access.profileId,
	};
}

async function currentSnapshot(sessionId: string) {
	const snapshot = await readTranscriptSnapshot({
		campaignSlug: CAMPAIGN_SLUG,
		sessionId,
	});
	if (!snapshot || snapshot.source !== "current_revision" || !snapshot.revisionId)
		return null;
	return snapshot;
}

export async function saveTranscriptRevisionEditAction(
	input: TranscriptRevisionEditInput,
) {
	const issues = validateTranscriptRevisionEditInput(input);
	if (issues.length)
		return { ok: false as const, reason: "validation" as const, issues };

	try {
		const identity = await editIdentity();
		if (!identity.ok)
			return { ok: false as const, reason: identity.reason, issues: [identity.reason] };

		const result = await persistTranscriptRevisionEdit(
			identity.authUserId,
			identity.profileId,
			CAMPAIGN_SLUG,
			input,
		);
		if (!result.ok) {
			const remote =
				result.reason === "stale_current"
					? await currentSnapshot(input.sessionId)
					: null;
			return {
				ok: false as const,
				reason: result.reason,
				issues: [result.reason],
				remote,
			};
		}

		const saved = await currentSnapshot(input.sessionId);
		if (!saved || saved.revisionId !== result.revisionId)
			return {
				ok: false as const,
				reason: "dependency_unavailable" as const,
				issues: ["dependency_unavailable"] as const,
			};
		return {
			ok: true as const,
			status: result.status,
			changedSegments: result.changedSegments,
			snapshot: saved,
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

export async function reloadCurrentTranscriptRevisionAction(sessionId: string) {
	const probe: TranscriptRevisionEditInput = {
		sessionId,
		expectedCurrentRevisionId: "00000000-0000-4000-8000-000000000000",
		operationId: "00000000-0000-4000-8000-000000000000",
		patches: [],
	};
	if (validateTranscriptRevisionEditInput(probe).includes("session_id"))
		return { ok: false as const, reason: "validation" as const };

	try {
		const identity = await editIdentity();
		if (!identity.ok) return { ok: false as const, reason: identity.reason };
		const snapshot = await currentSnapshot(sessionId);
		return snapshot
			? { ok: true as const, snapshot }
			: { ok: false as const, reason: "not_found" as const };
	} catch {
		console.error("[edit] transcript revision reload failed");
		return { ok: false as const, reason: "dependency_unavailable" as const };
	}
}
