import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import type { TranscriptRevisionEditPatch } from "./revision-edit-model";

export type TranscriptRevisionEditPersistenceInput = Readonly<{
	actorProfileId: string;
	campaignSlug: string;
	sessionId: string;
	expectedCurrentRevisionId: string;
	operationId: string;
	edits: readonly TranscriptRevisionEditPatch[];
}>;

export type TranscriptRevisionEditPersistenceResult =
	| Readonly<{
			status: "updated" | "no_change";
			revisionId: string;
			revisionNumber: number;
	  }>
	| Readonly<{ status: "conflict" | "not_found" | "forbidden" }>
	| Readonly<{ status: "dependency_unavailable" }>;

function parseResult(data: unknown): TranscriptRevisionEditPersistenceResult {
	if (!Array.isArray(data) || data.length !== 1) {
		return { status: "dependency_unavailable" };
	}
	const row = data[0] as Record<string, unknown>;
	if (
		(row.status === "updated" || row.status === "no_change") &&
		typeof row.revision_id === "string" &&
		typeof row.revision_number === "number" &&
		Number.isSafeInteger(row.revision_number) &&
		row.revision_number > 0
	) {
		return {
			status: row.status,
			revisionId: row.revision_id,
			revisionNumber: row.revision_number,
		};
	}
	if (
		row.status === "conflict" ||
		row.status === "not_found" ||
		row.status === "forbidden"
	) {
		return { status: row.status };
	}
	return { status: "dependency_unavailable" };
}

export async function persistTranscriptRevisionEdit(
	input: TranscriptRevisionEditPersistenceInput,
): Promise<TranscriptRevisionEditPersistenceResult> {
	const client = editDataClient();
	if (!client) return { status: "dependency_unavailable" };

	const { data, error } = await client.rpc("edit_transcript_revision_atomic", {
		p_actor_profile_id: input.actorProfileId,
		p_campaign_slug: input.campaignSlug,
		p_session_id: input.sessionId,
		p_expected_current_revision_id: input.expectedCurrentRevisionId,
		p_operation_id: input.operationId,
		p_edits: input.edits,
	});
	if (error) {
		console.error("[edit] immutable transcript revision RPC unavailable");
		return { status: "dependency_unavailable" };
	}
	return parseResult(data);
}
