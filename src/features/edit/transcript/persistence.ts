import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import type {
	TranscriptMutationPersistenceInput,
	TranscriptMutationPersistenceResult,
} from "./mutation";

type AtomicMutationRow = Readonly<{
	status?: unknown;
	revision?: unknown;
}>;

export function parseAtomicTranscriptMutationResult(
	data: unknown,
): TranscriptMutationPersistenceResult {
	if (!Array.isArray(data) || data.length !== 1) {
		return { status: "dependency_unavailable" };
	}

	const row = data[0] as AtomicMutationRow;
	switch (row.status) {
		case "updated":
			return typeof row.revision === "number" &&
				Number.isSafeInteger(row.revision) &&
				row.revision >= 0
				? { status: "updated", revision: row.revision }
				: { status: "dependency_unavailable" };
		case "conflict":
			return { status: "conflict" };
		case "not_found":
			return { status: "not_found" };
		default:
			return { status: "dependency_unavailable" };
	}
}

export async function persistTranscriptMutation(
	input: TranscriptMutationPersistenceInput,
): Promise<TranscriptMutationPersistenceResult> {
	const client = editDataClient();
	if (!client) return { status: "dependency_unavailable" };

	const { data, error } = await client.rpc("edit_transcript_segment_atomic", {
		p_actor_profile_id: input.actorProfileId,
		p_campaign_slug: input.campaignSlug,
		p_segment_id: input.segmentId,
		p_expected_revision: input.expectedRevision,
		p_text: input.edit.text,
		p_speaker_name: input.edit.speaker,
		p_review_status: input.edit.reviewStatus,
		p_needs_review: input.edit.needsReview,
		p_text_chars: input.edit.textChars,
		p_text_words: input.edit.textWords,
	});

	if (error) {
		console.error("[edit] atomic transcript RPC unavailable");
		return { status: "dependency_unavailable" };
	}
	return parseAtomicTranscriptMutationResult(data);
}
