import "server-only";

import { editDataClient } from "@/integrations/supabase/server";
import type { TranscriptRevisionEditChange } from "./revision-edit-model";

export type TranscriptRevisionEditPersistenceInput = Readonly<{
	actorProfileId: string;
	campaignSlug: string;
	sessionId: string;
	expectedCurrentRevisionId: string;
	operationId: string;
	changes: readonly TranscriptRevisionEditChange[];
}>;

export type TranscriptRevisionEditPersistenceResult =
	| Readonly<{
			status: "updated" | "replay" | "no_change";
			revisionId: string;
			revisionNumber: number;
			currentRevisionId: string;
	  }>
	| Readonly<{
			status: "stale_current";
			currentRevisionId: string | null;
	  }>
	| Readonly<{
			status:
				| "operation_conflict"
				| "forbidden"
				| "not_found"
				| "invalid_base"
				| "invalid_change"
				| "invalid_payload"
				| "dependency_unavailable";
	  }>;

type AtomicRow = Readonly<{
	status?: unknown;
	revision_id?: unknown;
	revision_number?: unknown;
	current_revision_id?: unknown;
}>;

function uuid(value: unknown): string | null {
	return typeof value === "string" && value.length >= 32 && value.length <= 40
		? value
		: null;
}

export function parseTranscriptRevisionEditResult(
	data: unknown,
): TranscriptRevisionEditPersistenceResult {
	if (!Array.isArray(data) || data.length !== 1)
		return { status: "dependency_unavailable" };

	const row = data[0] as AtomicRow;
	const currentRevisionId = uuid(row.current_revision_id);
	switch (row.status) {
		case "updated":
		case "replay":
		case "no_change": {
			const revisionId = uuid(row.revision_id);
			const revisionNumber =
				typeof row.revision_number === "number" &&
				Number.isSafeInteger(row.revision_number) &&
				row.revision_number > 0
					? row.revision_number
					: null;
			return revisionId && revisionNumber && currentRevisionId
				? {
						status: row.status,
						revisionId,
						revisionNumber,
						currentRevisionId,
					}
				: { status: "dependency_unavailable" };
		}
		case "stale_current":
			return { status: "stale_current", currentRevisionId };
		case "operation_conflict":
		case "forbidden":
		case "not_found":
		case "invalid_base":
		case "invalid_change":
		case "invalid_payload":
			return { status: row.status };
		default:
			return { status: "dependency_unavailable" };
	}
}

export async function persistTranscriptRevisionEdit(
	input: TranscriptRevisionEditPersistenceInput,
): Promise<TranscriptRevisionEditPersistenceResult> {
	const client = editDataClient();
	if (!client) return { status: "dependency_unavailable" };

	const { data, error } = await client.rpc("save_transcript_revision_edit_atomic", {
		p_actor_profile_id: input.actorProfileId,
		p_campaign_slug: input.campaignSlug,
		p_session_id: input.sessionId,
		p_expected_current_revision_id: input.expectedCurrentRevisionId,
		p_operation_id: input.operationId,
		p_changes: input.changes,
	});
	if (error) {
		console.error("[edit] transcript revision save unavailable");
		return { status: "dependency_unavailable" };
	}
	return parseTranscriptRevisionEditResult(data);
}
