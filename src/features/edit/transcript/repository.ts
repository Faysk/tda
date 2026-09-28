import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import { legacyTranscriptSnapshotSha256 } from "./legacy-snapshot";
import {
	normalizeRevisionSegments,
	sortLegacySegments,
	type TranscriptReaderSnapshot,
	type TranscriptReaderSegment,
} from "./reader-contract";
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
	revision: number;
	startMs: number;
	endMs: number;
	text: string;
	speakerName: string | null;
	characterName: string | null;
	speakerRole: string | null;
	trackKey: string | null;
	reviewStatus: TranscriptReviewStatus;
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

export type ReadTranscriptSegmentInput = Readonly<{
	campaignSlug: string;
	sessionId: string;
	segmentId: string;
}>;

function toSegment(row: Record<string, unknown>): EditTranscriptSegment {
	const reviewStatus = normalizeTranscriptReviewStatus(row.review_status);
	if (
		typeof row.id !== "string" ||
		typeof row.session_id !== "string" ||
		typeof row.revision !== "number" ||
		!Number.isSafeInteger(row.revision) ||
		row.revision < 0 ||
		typeof row.start_ms !== "number" ||
		typeof row.end_ms !== "number" ||
		typeof row.text !== "string" ||
		!reviewStatus
	) {
		throw new Error("Transcript row does not match the Edit contract");
	}

	return {
		id: row.id,
		sessionId: row.session_id,
		revision: row.revision,
		startMs: row.start_ms,
		endMs: row.end_ms,
		text: row.text,
		speakerName: typeof row.speaker_name === "string" ? row.speaker_name : null,
		characterName:
			typeof row.character_name === "string" ? row.character_name : null,
		speakerRole: typeof row.speaker_role === "string" ? row.speaker_role : null,
		trackKey: typeof row.track_key === "string" ? row.track_key : null,
		reviewStatus,
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
			"id,session_id,revision,start_ms,end_ms,text,speaker_name,character_name,speaker_role,track_key,review_status,source_segment_id,source_file_id,source_chunk_id,text_chars,text_words",
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


export async function readTranscriptSegment(
	input: ReadTranscriptSegmentInput,
): Promise<EditTranscriptSegment | null> {
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

	const { data, error } = await client
		.from("transcript_segments")
		.select(
			"id,session_id,revision,start_ms,end_ms,text,speaker_name,character_name,speaker_role,track_key,review_status,source_segment_id,source_file_id,source_chunk_id,text_chars,text_words",
		)
		.eq("id", input.segmentId)
		.eq("session_id", input.sessionId)
		.maybeSingle();

	if (error) throw new Error("Transcript segment unavailable");
	return data ? toSegment(data as Record<string, unknown>) : null;
}


const READER_BATCH_SIZE = 1000;

function legacyTrackNumber(value: unknown): number {
	if (typeof value !== "string") return 1;
	const normalized = value.trim();
	if (!/^[0-9]{1,9}$/u.test(normalized)) return 1;
	const parsed = Number(normalized);
	return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 9999 ? parsed : 1;
}

function legacySegmentIdentity(row: Record<string, unknown>): string {
	const source =
		typeof row.source_segment_id === "string"
			? row.source_segment_id.trim()
			: "";
	return source || String(row.id || "");
}

function toReaderLegacySegment(row: Record<string, unknown>): TranscriptReaderSegment {
	if (
		typeof row.id !== "string" ||
		typeof row.start_ms !== "number" ||
		typeof row.end_ms !== "number" ||
		typeof row.text !== "string"
	)
		throw new Error("Legacy transcript segment is invalid");
	const trackNumber = legacyTrackNumber(row.track_key);
	const sourceSegmentId = legacySegmentIdentity(row);
	if (!sourceSegmentId) throw new Error("Legacy transcript segment identity is invalid");
	const speaker =
		(typeof row.character_name === "string" && row.character_name.trim()) ||
		(typeof row.speaker_name === "string" && row.speaker_name.trim()) ||
		(typeof row.track_key === "string" && row.track_key.trim()) ||
		"Mesa";
	return {
		id: `l-${trackNumber}-${sourceSegmentId}`,
		sourceSegmentId,
		trackNumber,
		startMs: row.start_ms,
		endMs: row.end_ms,
		speaker,
		text: row.text,
	};
}

export async function readTranscriptSnapshot(input: {
	campaignSlug: string;
	sessionId: string;
}): Promise<TranscriptReaderSnapshot | null> {
	const client = editDataClient();
	if (!client) return null;
	const { data: session, error: sessionError } = await client
		.from("sessions")
		.select("id,campaign_id,current_transcript_revision_id,campaigns!inner(slug)")
		.eq("id", input.sessionId)
		.eq("campaigns.slug", input.campaignSlug)
		.maybeSingle();
	if (sessionError) throw new Error("Edit session lookup unavailable");
	if (!session) return null;

	const currentRevisionId =
		typeof session.current_transcript_revision_id === "string"
			? session.current_transcript_revision_id
			: null;
	if (currentRevisionId) {
		const { data: revision, error } = await client
			.from("transcript_revisions")
			.select("id,revision_number,segments")
			.eq("id", currentRevisionId)
			.eq("session_id", input.sessionId)
			.eq("campaign_id", session.campaign_id)
			.maybeSingle();
		if (error) throw new Error("Current transcript revision unavailable");
		if (!revision)
			throw new Error("Current transcript revision pointer is invalid");
		if (
			typeof revision.id !== "string" ||
			typeof revision.revision_number !== "number" ||
			!Number.isSafeInteger(revision.revision_number) ||
			revision.revision_number < 1
		)
			throw new Error("Current transcript revision metadata is invalid");
		return {
			source: "current_revision",
			revisionId: revision.id,
			revisionNumber: revision.revision_number,
			segments: normalizeRevisionSegments(revision.segments),
		};
	}

	const segments: TranscriptReaderSegment[] = [];
	for (let from = 0; ; from += READER_BATCH_SIZE) {
		const { data, error } = await client
			.from("transcript_segments")
			.select("id,start_ms,end_ms,text,speaker_name,character_name,track_key,source_segment_id")
			.eq("session_id", input.sessionId)
			.order("start_ms", { ascending: true })
			.order("end_ms", { ascending: true })
			.order("id", { ascending: true })
			.range(from, from + READER_BATCH_SIZE - 1);
		if (error) throw new Error("Legacy transcript unavailable");
		const rows = (data ?? []) as Record<string, unknown>[];
		segments.push(...rows.map(toReaderLegacySegment));
		if (rows.length < READER_BATCH_SIZE) break;
	}
	const sorted = sortLegacySegments(segments);
	return {
		source: "legacy_segments",
		revisionId: null,
		revisionNumber: null,
		segments: sorted,
		legacySnapshotSha256: legacyTranscriptSnapshotSha256(sorted),
	};
}
