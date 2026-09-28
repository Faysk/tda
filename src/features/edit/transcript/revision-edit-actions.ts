"use server";

import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import { readTranscriptSnapshot } from "./repository";
import {
	prepareTranscriptRevisionEdits,
	type TranscriptRevisionEdit,
} from "./revision-edit-contract";

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SaveTranscriptRevisionEditsInput = Readonly<{
	sessionId: string;
	expectedCurrentRevisionId: string;
	operationId: string;
	edits: readonly TranscriptRevisionEdit[];
}>;

type RpcRow = Readonly<{
	status?: unknown;
	revision_id?: unknown;
	revision_number?: unknown;
	current_revision_id?: unknown;
}>;

function id(value: unknown): string | null {
	return typeof value === "string" && UUID.test(value) ? value : null;
}

function revisionNumber(value: unknown): number | null {
	return typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value > 0
		? value
		: null;
}

export async function saveTranscriptRevisionEditsAction(
	input: SaveTranscriptRevisionEditsInput,
) {
	if (
		!UUID.test(input.sessionId) ||
		!UUID.test(input.expectedCurrentRevisionId) ||
		!UUID.test(input.operationId)
	) {
		return {
			ok: false as const,
			reason: "validation" as const,
			issues: ["identity"] as const,
		};
	}

	const prepared = prepareTranscriptRevisionEdits(input.edits);
	if (!prepared.ok) {
		return {
			ok: false as const,
			reason: "validation" as const,
			issues: [prepared.reason] as const,
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

		const client = editDataClient();
		if (!client) {
			return {
				ok: false as const,
				reason: "dependency_unavailable" as const,
				issues: ["dependency_unavailable"] as const,
			};
		}

		const { data, error } = await client.rpc(
			"edit_current_transcript_revision_atomic",
			{
				p_actor_profile_id: access.profileId,
				p_campaign_slug: CAMPAIGN_SLUG,
				p_session_id: input.sessionId,
				p_expected_current_revision_id: input.expectedCurrentRevisionId,
				p_operation_id: input.operationId,
				p_edits: prepared.value.map((edit) => ({
					track_number: edit.trackNumber,
					segment_id: edit.segmentId,
					speaker: edit.speaker,
					text: edit.text,
				})),
			},
		);
		if (error || !Array.isArray(data) || data.length !== 1) {
			console.error("[edit] inline transcript revision RPC unavailable");
			return {
				ok: false as const,
				reason: "dependency_unavailable" as const,
				issues: ["dependency_unavailable"] as const,
			};
		}

		const row = data[0] as RpcRow;
		const status = typeof row.status === "string" ? row.status : "";
		if (status === "stale_current" || status === "conflict") {
			return {
				ok: false as const,
				reason: "conflict" as const,
				issues: ["conflict"] as const,
				currentRevisionId: id(row.current_revision_id),
			};
		}
		if (status === "not_found") {
			return {
				ok: false as const,
				reason: "not_found" as const,
				issues: ["not_found"] as const,
			};
		}
		if (status === "invalid_payload" || status === "invalid_edit") {
			return {
				ok: false as const,
				reason: "validation" as const,
				issues: [status] as const,
			};
		}
		if (
			status !== "updated" &&
			status !== "replay" &&
			status !== "unchanged"
		) {
			return {
				ok: false as const,
				reason: "dependency_unavailable" as const,
				issues: ["dependency_unavailable"] as const,
			};
		}

		const revisionId = id(row.revision_id);
		const number = revisionNumber(row.revision_number);
		const currentRevisionId = id(row.current_revision_id);
		if (!revisionId || !number || !currentRevisionId || revisionId !== currentRevisionId) {
			return {
				ok: false as const,
				reason: "dependency_unavailable" as const,
				issues: ["dependency_unavailable"] as const,
			};
		}

		const snapshot = await readTranscriptSnapshot({
			campaignSlug: CAMPAIGN_SLUG,
			sessionId: input.sessionId,
		});
		if (
			!snapshot ||
			snapshot.source !== "current_revision" ||
			snapshot.revisionId !== currentRevisionId ||
			snapshot.revisionNumber !== number
		) {
			return {
				ok: false as const,
				reason: "dependency_unavailable" as const,
				issues: ["dependency_unavailable"] as const,
			};
		}

		return {
			ok: true as const,
			status: status as "updated" | "replay" | "unchanged",
			revisionId,
			revisionNumber: number,
		};
	} catch {
		console.error("[edit] inline transcript revision save failed");
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
			issues: ["dependency_unavailable"] as const,
		};
	}
}
