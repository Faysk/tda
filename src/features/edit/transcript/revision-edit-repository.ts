import "server-only";

import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import type { TranscriptRevisionEditInput } from "./revision-edit-contract";

type PersistResult =
	| Readonly<{
			ok: true;
			status: "updated" | "replay" | "no_change";
			revisionId: string;
			revisionNumber: number;
	  }>
	| Readonly<{
			ok: false;
			reason:
				| "forbidden"
				| "not_found"
				| "invalid_base"
				| "invalid_edits"
				| "stale_current"
				| "conflict"
				| "dependency_unavailable";
			currentRevisionId?: string | null;
	  }>;

export async function persistTranscriptRevisionEdits(
	actorProfileId: string,
	input: TranscriptRevisionEditInput,
): Promise<PersistResult> {
	const client = editDataClient();
	if (!client)
		return { ok: false, reason: "dependency_unavailable" };

	const { data, error } = await client.rpc("save_transcript_revision_edit_atomic", {
		p_actor_profile_id: actorProfileId,
		p_campaign_slug: CAMPAIGN_SLUG,
		p_session_id: input.sessionId,
		p_operation_id: input.operationId,
		p_expected_current_revision_id: input.expectedCurrentRevisionId,
		p_edits: input.edits.map((edit) => ({
			track_number: edit.trackNumber,
			segment_id: edit.segmentId,
			speaker: edit.speaker,
			text: edit.text,
		})),
	});
	if (error || !Array.isArray(data) || data.length !== 1)
		return { ok: false, reason: "dependency_unavailable" };

	const row = data[0] as Record<string, unknown>;
	const status = typeof row.status === "string" ? row.status : "";
	if (["updated", "replay", "no_change"].includes(status)) {
		if (
			typeof row.revision_id !== "string" ||
			typeof row.revision_number !== "number" ||
			!Number.isSafeInteger(row.revision_number) ||
			row.revision_number < 1
		)
			return { ok: false, reason: "dependency_unavailable" };
		return {
			ok: true,
			status: status as "updated" | "replay" | "no_change",
			revisionId: row.revision_id,
			revisionNumber: row.revision_number,
		};
	}

	if (
		[
			"forbidden",
			"not_found",
			"invalid_base",
			"invalid_edits",
			"stale_current",
			"conflict",
		].includes(status)
	) {
		return {
			ok: false,
			reason: status as Exclude<PersistResult, { ok: true }>["reason"],
			currentRevisionId:
				status === "stale_current" && typeof row.revision_id === "string"
					? row.revision_id
					: undefined,
		};
	}
	return { ok: false, reason: "dependency_unavailable" };
}
