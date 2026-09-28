import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import type { TranscriptRevisionPatch } from "./revision-edit-model";

export type TranscriptRevisionEditPersistenceResult =
	| Readonly<{
			status: "saved";
			revisionId: string;
			revisionNumber: number;
			parentRevisionId: string | null;
			changedSegments: number;
			replayed: boolean;
			unchanged: boolean;
	  }>
	| Readonly<{
			status: "stale_current";
			currentRevisionId: string | null;
			currentRevisionNumber: number | null;
	  }>
	| Readonly<{ status: "operation_conflict" }>
	| Readonly<{ status: "invalid_payload" }>
	| Readonly<{ status: "not_found" }>
	| Readonly<{ status: "forbidden" }>
	| Readonly<{ status: "dependency_unavailable" }>;

type Input = Readonly<{
	authUserId: string;
	actorProfileId: string;
	campaignSlug: string;
	sessionId: string;
	expectedCurrentTranscriptRevisionId: string;
	operationId: string;
	patches: readonly TranscriptRevisionPatch[];
}>;

function integer(value: unknown): number | null {
	return typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 0
		? value
		: null;
}

function uuid(value: unknown): string | null {
	return typeof value === "string" && value.length <= 64 ? value : null;
}

export function parseTranscriptRevisionEditResult(
	data: unknown,
): TranscriptRevisionEditPersistenceResult {
	if (!data || typeof data !== "object" || Array.isArray(data))
		return { status: "dependency_unavailable" };
	const row = data as Record<string, unknown>;
	if (row.ok === true) {
		const revisionId = uuid(row.revisionId);
		const revisionNumber = integer(row.revisionNumber);
		const changedSegments = integer(row.changedSegments);
		if (
			!revisionId ||
			revisionNumber === null ||
			revisionNumber < 1 ||
			changedSegments === null ||
			typeof row.replayed !== "boolean" ||
			typeof row.unchanged !== "boolean"
		)
			return { status: "dependency_unavailable" };
		return {
			status: "saved",
			revisionId,
			revisionNumber,
			parentRevisionId: uuid(row.parentRevisionId),
			changedSegments,
			replayed: row.replayed,
			unchanged: row.unchanged,
		};
	}
	if (row.ok !== false || typeof row.reason !== "string")
		return { status: "dependency_unavailable" };
	switch (row.reason) {
		case "stale_current":
			return {
				status: "stale_current",
				currentRevisionId: uuid(row.currentRevisionId),
				currentRevisionNumber:
					row.currentRevisionNumber === null
						? null
						: integer(row.currentRevisionNumber),
			};
		case "operation_conflict":
		case "invalid_payload":
		case "not_found":
		case "forbidden":
			return { status: row.reason };
		default:
			return { status: "dependency_unavailable" };
	}
}

export async function persistTranscriptRevisionEdit(
	input: Input,
): Promise<TranscriptRevisionEditPersistenceResult> {
	const client = editDataClient();
	if (!client) return { status: "dependency_unavailable" };

	const { data, error } = await client.rpc(
		"edit_current_transcript_revision_atomic",
		{
			p_auth_user_id: input.authUserId,
			p_actor_profile_id: input.actorProfileId,
			p_campaign_slug: input.campaignSlug,
			p_session_id: input.sessionId,
			p_expected_current_revision_id:
				input.expectedCurrentTranscriptRevisionId,
			p_operation_id: input.operationId,
			p_patches: input.patches,
		},
	);
	if (error) {
		console.error("[edit] private transcript revision save unavailable");
		return { status: "dependency_unavailable" };
	}
	return parseTranscriptRevisionEditResult(data);
}
