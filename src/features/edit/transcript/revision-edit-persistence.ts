import "server-only";

import { editDataClient } from "@/integrations/supabase/server";
import {
	parseTranscriptRevisionEditResult,
	type TranscriptRevisionEditChange,
	type TranscriptRevisionEditPersistenceResult,
} from "./revision-edit-model";

export type TranscriptRevisionEditPersistenceInput = Readonly<{
	actorProfileId: string;
	campaignSlug: string;
	sessionId: string;
	expectedCurrentRevisionId: string;
	operationId: string;
	changes: readonly TranscriptRevisionEditChange[];
}>;

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
