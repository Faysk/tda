import {
	countWordsV1,
	isReviewStringV1,
} from "@/features/transcript-review/text-contract";

export const MAX_TRANSCRIPT_EDIT_SEGMENTS = 100_000;
export const MAX_TRANSCRIPT_EDIT_REQUEST_BYTES = 34 * 1024 * 1024;

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type TranscriptEditSegment = Readonly<{
	trackNumber: number;
	segmentId: string;
	startSeconds: number;
	endSeconds: number;
	speaker: string;
	text: string;
	reviewed: boolean;
}>;

export type TranscriptRevisionEditRequest = Readonly<{
	sessionId: string;
	expectedCurrentRevisionId: string;
	operationId: string;
	segments: readonly TranscriptEditSegment[];
}>;

export type TranscriptRevisionEditIssue =
	| "identity"
	| "segment_count"
	| "segment_identity"
	| "segment_timing"
	| "speaker"
	| "text";

export type PersistedTranscriptEditSegment = Readonly<{
	track_number: number;
	segment_id: string;
	start: number;
	end: number;
	speaker: string;
	text: string;
	reviewed: boolean;
}>;

function finiteSeconds(value: number): boolean {
	return Number.isFinite(value) && value >= 0 && value <= 604_800;
}

export function validateTranscriptRevisionEditRequest(
	input: TranscriptRevisionEditRequest,
): readonly TranscriptRevisionEditIssue[] {
	const issues = new Set<TranscriptRevisionEditIssue>();
	if (
		!UUID.test(input.sessionId) ||
		!UUID.test(input.expectedCurrentRevisionId) ||
		!UUID.test(input.operationId)
	)
		issues.add("identity");
	if (
		!Array.isArray(input.segments) ||
		input.segments.length < 1 ||
		input.segments.length > MAX_TRANSCRIPT_EDIT_SEGMENTS
	)
		issues.add("segment_count");

	const seen = new Set<string>();
	for (const segment of input.segments) {
		if (
			!Number.isSafeInteger(segment.trackNumber) ||
			segment.trackNumber < 1 ||
			segment.trackNumber > 9999 ||
			typeof segment.segmentId !== "string" ||
			segment.segmentId.length < 1 ||
			segment.segmentId.length > 256
		) {
			issues.add("segment_identity");
		} else {
			const identity = `${segment.trackNumber}\u0000${segment.segmentId}`;
			if (seen.has(identity)) issues.add("segment_identity");
			seen.add(identity);
		}
		if (
			!finiteSeconds(segment.startSeconds) ||
			!finiteSeconds(segment.endSeconds) ||
			segment.endSeconds < segment.startSeconds
		)
			issues.add("segment_timing");
		if (!isReviewStringV1(segment.speaker, "speaker")) issues.add("speaker");
		if (!isReviewStringV1(segment.text, "text")) issues.add("text");
		if (typeof segment.reviewed !== "boolean") issues.add("segment_identity");
	}
	return [...issues];
}

export function persistedTranscriptEditSegments(
	segments: readonly TranscriptEditSegment[],
): PersistedTranscriptEditSegment[] {
	return segments.map((segment) => ({
		track_number: segment.trackNumber,
		segment_id: segment.segmentId,
		start: segment.startSeconds,
		end: segment.endSeconds,
		speaker: segment.speaker,
		text: segment.text,
		reviewed: segment.reviewed,
	}));
}

export function transcriptEditWordCount(
	segments: readonly TranscriptEditSegment[],
): number {
	return segments.reduce((total, segment) => total + countWordsV1(segment.text), 0);
}
