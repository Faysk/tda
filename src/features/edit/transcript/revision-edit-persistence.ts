import "server-only";

import { editDataClient } from "@/integrations/supabase/server";
import {
	applyTranscriptRevisionPatches,
	type TranscriptRevisionEditInput,
} from "./revision-edit-contract";

type RpcResult = Readonly<{
	status?: unknown;
	revision_id?: unknown;
	revision_number?: unknown;
	current_revision_id?: unknown;
	changed_segments?: unknown;
}>;

export type PersistTranscriptRevisionEditResult =
	| Readonly<{
			ok: true;
			status: "updated" | "replay" | "no_changes";
			revisionId: string;
			revisionNumber: number;
			changedSegments: number;
	  }>
	| Readonly<{
			ok: false;
			reason:
				| "stale_current"
				| "operation_conflict"
				| "validation"
				| "not_found"
				| "forbidden"
				| "dependency_unavailable";
			currentRevisionId?: string | null;
	  }>;

function id(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 && value.length <= 100
		? value
		: null;
}

function integer(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

export async function persistTranscriptRevisionEdit(
	authUserId: string,
	actorProfileId: string,
	campaignSlug: string,
	input: TranscriptRevisionEditInput,
): Promise<PersistTranscriptRevisionEditResult> {
	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data: revisionRaw, error: revisionError } = await client
		.from("transcript_revisions")
		.select("id,segments")
		.eq("id", input.expectedCurrentRevisionId)
		.eq("session_id", input.sessionId)
		.maybeSingle();
	if (revisionError) return { ok: false, reason: "dependency_unavailable" };
	if (!revisionRaw) return { ok: false, reason: "not_found" };

	const prepared = applyTranscriptRevisionPatches(
		(revisionRaw as { segments?: unknown }).segments,
		input.patches,
	);
	if (!prepared.ok)
		return {
			ok: false,
			reason: prepared.reason === "unknown_segment" ? "validation" : "dependency_unavailable",
		};

	const { data, error } = await client.rpc("save_transcript_revision_edit_atomic", {
		p_auth_user_id: authUserId,
		p_actor_profile_id: actorProfileId,
		p_campaign_slug: campaignSlug,
		p_session_id: input.sessionId,
		p_expected_current_revision_id: input.expectedCurrentRevisionId,
		p_operation_id: input.operationId,
		p_segments: prepared.segments,
	});
	if (error || !data || typeof data !== "object" || Array.isArray(data))
		return { ok: false, reason: "dependency_unavailable" };

	const row = data as RpcResult;
	const status = typeof row.status === "string" ? row.status : "";
	if (status === "stale_current" || status === "replay_stale")
		return {
			ok: false,
			reason: "stale_current",
			currentRevisionId: id(row.current_revision_id),
		};
	if (status === "operation_conflict")
		return { ok: false, reason: "operation_conflict" };
	if (status === "invalid_payload")
		return { ok: false, reason: "validation" };
	if (status === "not_found") return { ok: false, reason: "not_found" };
	if (status === "forbidden") return { ok: false, reason: "forbidden" };
	if (status !== "updated" && status !== "replay" && status !== "no_changes")
		return { ok: false, reason: "dependency_unavailable" };

	const revisionId = id(row.revision_id);
	const revisionNumber = integer(row.revision_number);
	const changedSegments = integer(row.changed_segments);
	if (!revisionId || revisionNumber === null || changedSegments === null)
		return { ok: false, reason: "dependency_unavailable" };
	return {
		ok: true,
		status,
		revisionId,
		revisionNumber,
		changedSegments,
	};
}
