import "server-only";

import { editDataClient } from "@/integrations/supabase/server";
import type { TranscriptEditRequest } from "./edit-model";

export type TranscriptEditPersistenceResult =
	| Readonly<{
			ok: true;
			status: "updated" | "replay" | "no_change";
			revisionId: string;
			revisionNumber: number;
	  }>
	| Readonly<{
			ok: false;
			reason:
				| "stale_current"
				| "operation_conflict"
				| "invalid_payload"
				| "invalid_edit_target"
				| "not_found"
				| "forbidden"
				| "dependency_unavailable";
			currentRevisionId?: string | null;
			currentRevisionNumber?: number | null;
	  }>;

function revisionNumber(value: unknown): number | null {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function persistTranscriptRevisionEdits(input: {
	authUserId: string;
	actorProfileId: string;
	campaignSlug: string;
	request: TranscriptEditRequest;
}): Promise<TranscriptEditPersistenceResult> {
	const client = editDataClient();
	if (!client)
		return { ok: false, reason: "dependency_unavailable" };

	const { data, error } = await client.rpc("save_transcript_revision_edit_atomic", {
		p_auth_user_id: input.authUserId,
		p_actor_profile_id: input.actorProfileId,
		p_campaign_slug: input.campaignSlug,
		p_session_id: input.request.sessionId,
		p_expected_current_revision_id:
			input.request.expectedCurrentTranscriptRevisionId,
		p_operation_id: input.request.operationId,
		p_edits: input.request.edits,
	});
	if (error || !Array.isArray(data) || data.length !== 1)
		return { ok: false, reason: "dependency_unavailable" };

	const row = data[0] as Record<string, unknown>;
	const status = typeof row.status === "string" ? row.status : "";
	const id = typeof row.revision_id === "string" ? row.revision_id : null;
	const number = revisionNumber(row.revision_number);

	if (
		(status === "updated" || status === "replay" || status === "no_change") &&
		id &&
		number !== null
	) {
		return {
			ok: true,
			status,
			revisionId: id,
			revisionNumber: number,
		};
	}

	if (status === "stale_current") {
		return {
			ok: false,
			reason: "stale_current",
			currentRevisionId: id,
			currentRevisionNumber: number,
		};
	}

	if (
		status === "operation_conflict" ||
		status === "invalid_payload" ||
		status === "invalid_edit_target" ||
		status === "not_found" ||
		status === "forbidden"
	) {
		return { ok: false, reason: status };
	}

	return { ok: false, reason: "dependency_unavailable" };
}
