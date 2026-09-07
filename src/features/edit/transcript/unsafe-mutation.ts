import "server-only";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import { requireUnsafeEdit } from "../unsafe-access";
import {
	prepareTranscriptEdit,
	transcriptSpeakerIdentityChanged,
	type TranscriptEditInput,
} from "./model";

export type UnsafeUpdatedSegment = Readonly<{
	id: string;
	text: string;
	speaker: string;
	reviewStatus: "pending" | "approved" | "needs_review" | "discarded";
	needsReview: boolean;
	textChars: number;
	textWords: number;
}>;

export async function unsafeUpdateTranscriptSegment(input: Readonly<{
	sessionId: string;
	segmentId: string;
	edit: TranscriptEditInput;
}>): Promise<
	| Readonly<{ ok: true; segment: UnsafeUpdatedSegment }>
	| Readonly<{ ok: false; issues: readonly string[] }>
> {
	requireUnsafeEdit();
	const prepared = prepareTranscriptEdit(input.edit);
	if (!prepared.ok) return prepared;
	if (!input.sessionId || input.sessionId.length > 80) {
		return { ok: false, issues: ["session_invalid"] };
	}
	if (!input.segmentId || input.segmentId.length > 80) {
		return { ok: false, issues: ["segment_invalid"] };
	}

	const client = editDataClient();
	if (!client) return { ok: false, issues: ["dependency_unavailable"] };

	const { data: session, error: sessionError } = await client
		.from("sessions")
		.select("id,campaigns!inner(slug)")
		.eq("id", input.sessionId)
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.maybeSingle();
	if (sessionError) throw new Error("Unsafe Edit session lookup failed");
	if (!session) return { ok: false, issues: ["session_not_found"] };

	const { data: currentSegment, error: segmentError } = await client
		.from("transcript_segments")
		.select("id,speaker_name")
		.eq("session_id", input.sessionId)
		.eq("id", input.segmentId)
		.maybeSingle();
	if (segmentError) throw new Error("Unsafe Edit transcript lookup failed");
	if (!currentSegment) return { ok: false, issues: ["segment_not_found"] };

	const value = prepared.value;
	const update: Record<string, unknown> = {
		text: value.text,
		text_chars: value.textChars,
		text_words: value.textWords,
		speaker_name: value.speaker,
		review_status: value.reviewStatus,
		needs_review: value.needsReview,
		is_empty: false,
	};
	if (
		transcriptSpeakerIdentityChanged(
			currentSegment.speaker_name,
			value.speaker,
		)
	) {
		update.character_name = null;
	}

	const { data, error } = await client
		.from("transcript_segments")
		.update(update)
		.eq("session_id", input.sessionId)
		.eq("id", input.segmentId)
		.select("id,text,speaker_name,review_status,needs_review,text_chars,text_words")
		.maybeSingle();
	if (error) throw new Error("Unsafe Edit transcript update failed");
	if (!data) return { ok: false, issues: ["segment_not_found"] };

	return {
		ok: true,
		segment: {
			id: data.id,
			text: data.text,
			speaker: data.speaker_name || value.speaker,
			reviewStatus: value.reviewStatus,
			needsReview: data.needs_review,
			textChars: data.text_chars ?? value.textChars,
			textWords: data.text_words ?? value.textWords,
		},
	};
}
