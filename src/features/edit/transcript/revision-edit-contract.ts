import { isReviewStringV1 } from "@/features/transcript-review/text-contract";

export const TRANSCRIPT_REVISION_EDIT_LIMIT = 100_000;

export type TranscriptRevisionEdit = Readonly<{
	trackNumber: number;
	segmentId: string;
	speaker: string;
	text: string;
}>;

export type TranscriptRevisionEditInput = Readonly<{
	sessionId: string;
	expectedCurrentRevisionId: string;
	operationId: string;
	edits: readonly TranscriptRevisionEdit[];
}>;

export const TRANSCRIPT_EDIT_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function revisionSegmentId(
	trackNumber: number,
	readerId: string,
): string | null {
	const prefix = `r-${trackNumber}-`;
	if (!readerId.startsWith(prefix)) return null;
	const value = readerId.slice(prefix.length);
	return value.length > 0 && value.length <= 256 ? value : null;
}

export function validateTranscriptRevisionEdits(
	input: TranscriptRevisionEditInput,
): readonly string[] {
	const issues: string[] = [];
	if (
		!TRANSCRIPT_EDIT_UUID.test(input.sessionId) ||
		!TRANSCRIPT_EDIT_UUID.test(input.expectedCurrentRevisionId) ||
		!TRANSCRIPT_EDIT_UUID.test(input.operationId)
	)
		issues.push("identity");
	if (!Array.isArray(input.edits) || input.edits.length > TRANSCRIPT_REVISION_EDIT_LIMIT)
		issues.push("edit_count");

	const seen = new Set<string>();
	for (const edit of input.edits) {
		if (
			!Number.isSafeInteger(edit.trackNumber) ||
			edit.trackNumber < 1 ||
			edit.trackNumber > 9999 ||
			typeof edit.segmentId !== "string" ||
			edit.segmentId.length < 1 ||
			edit.segmentId.length > 256
		) {
			issues.push("segment_identity");
			continue;
		}
		const identity = `${edit.trackNumber}\u0000${edit.segmentId}`;
		if (seen.has(identity)) issues.push("duplicate_segment");
		seen.add(identity);
		if (!isReviewStringV1(edit.speaker, "speaker")) issues.push("speaker");
		if (!isReviewStringV1(edit.text, "text")) issues.push("text");
	}
	return [...new Set(issues)];
}
