import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import {
	normalizeTranscriptReviewStatus,
	type TranscriptReviewStatus,
} from "./model";

export type TranscriptCursor = Readonly<{
	startMs: number;
	id: string;
}>;

export type EditTranscriptSegment = Readonly<{
	id: string;
	sessionId: string;
	startMs: number;
	endMs: number;
	text: string;
	speakerName: string | null;
	characterName: string | null;
	speakerRole: string | null;
	trackKey: string | null;
	reviewStatus: TranscriptReviewStatus;
	needsReview: boolean;
	sourceSegmentId: string | null;
	sourceFileId: string | null;
	sourceChunkId: string | null;
	textChars: number | null;
	textWords: number | null;
}>;

export type EditTranscriptPage = Readonly<{
	segments: readonly EditTranscriptSegment[];
	nextCursor: TranscriptCursor | null;
}>;

export type ReadTranscriptPageInput = Readonly<{
	campaignSlug: string;
	sessionId: string;
	limit: number;
	cursor: TranscriptCursor | null;
}>;

function toSegment(row: Record<string, unknown>): EditTranscriptSegment {
	const reviewStatus = normalizeTranscriptReviewStatus(row.review_status);
	if (
		typeof row.id !== "string" ||
		typeof row.session_id !== "string" ||
		typeof row.start_ms !== "number" ||
		typeof row.end_ms !== "number" ||
		typeof row.text !== "string" ||
		typeof row.needs_review !== "boolean" ||
		!reviewStatus
	) {
		throw new Error("Transcript row does not match the Edit contract");
	}

	return {
		id: row.id,
		sessionId: row.session_id,
		startMs: row.start_ms,
		endMs: row.end_ms,
		text: row.text,
		speakerName: typeof row.speaker_name === "string" ? row.speaker_name : null,
		characterName:
			typeof row.character_name === "string" ? row.character_name : null,
		speakerRole: typeof row.speaker_role === "string" ? row.speaker_role : null,
		trackKey: typeof row.track_key === "string" ? row.track_key : null,
		reviewStatus,
		needsReview: row.needs_review,
		sourceSegmentId:
			typeof row.source_segment_id === "string" ? row.source_segment_id : null,
		sourceFileId:
			typeof row.source_file_id === "string" ? row.source_file_id : null,
		sourceChunkId:
			typeof row.source_chunk_id === "string" ? row.source_chunk_id : null,
		textChars: typeof row.text_chars === "number" ? row.text_chars : null,
		textWords: typeof row.text_words === "number" ? row.text_words : null,
	};
}

export async function readTranscriptPage(
	input: ReadTranscriptPageInput,
): Promise<EditTranscriptPage | null> {
	const client = editDataClient();
	if (!client) return null;

	const { data: session, error: sessionError } = await client
		.from("sessions")
		.select("id,campaigns!inner(slug)")
		.eq("id", input.sessionId)
		.eq("campaigns.slug", input.campaignSlug)
		.maybeSingle();

	if (sessionError) throw new Error("Edit session lookup unavailable");
	if (!session) return null;

	let query = client
		.from("transcript_segments")
		.select(
			"id,session_id,start_ms,end_ms,text,speaker_name,character_name,speaker_role,track_key,review_status,needs_review,source_segment_id,source_file_id,source_chunk_id,text_chars,text_words",
		)
		.eq("session_id", input.sessionId)
		.order("start_ms", { ascending: true })
		.order("id", { ascending: true })
		.limit(input.limit + 1);

	if (input.cursor) {
		query = query.or(
			`start_ms.gt.${input.cursor.startMs},and(start_ms.eq.${input.cursor.startMs},id.gt.${input.cursor.id})`,
		);
	}

	const { data, error } = await query;
	if (error) throw new Error("Transcript page unavailable");

	const rows = (data ?? []) as Record<string, unknown>[];
	const hasMore = rows.length > input.limit;
	const visibleRows = hasMore ? rows.slice(0, input.limit) : rows;
	const segments = visibleRows.map(toSegment);
	const last = segments.at(-1);

	return {
		segments,
		nextCursor:
			hasMore && last ? { startMs: last.startMs, id: last.id } : null,
	};
}
