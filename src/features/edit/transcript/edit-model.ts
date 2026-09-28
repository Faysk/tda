const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const TRANSCRIPT_EDIT_LIMITS = {
	segmentId: 256,
	speaker: 160,
	text: 100000,
	edits: 100000,
} as const;

export type TranscriptSegmentEdit = Readonly<{
	trackNumber: number;
	segmentId: string;
	speaker: string;
	text: string;
}>;

export type TranscriptEditRequest = Readonly<{
	sessionId: string;
	expectedCurrentTranscriptRevisionId: string;
	operationId: string;
	edits: readonly TranscriptSegmentEdit[];
}>;

export function transcriptScalarLength(value: string): number | null {
	let length = 0;
	for (const char of value) {
		const code = char.codePointAt(0);
		if (code === undefined || (code >= 0xd800 && code <= 0xdfff)) return null;
		length += 1;
	}
	return length;
}

function validText(value: unknown, maximum: number): value is string {
	if (typeof value !== "string") return false;
	const length = transcriptScalarLength(value);
	return (
		length !== null &&
		length <= maximum &&
		value.trim().length > 0 &&
		!value.includes("\u0000")
	);
}

export function validateTranscriptEditRequest(
	input: TranscriptEditRequest,
): readonly string[] {
	const issues: string[] = [];
	if (!UUID.test(input.sessionId)) issues.push("session_id");
	if (!UUID.test(input.expectedCurrentTranscriptRevisionId))
		issues.push("expected_current_revision_id");
	if (!UUID.test(input.operationId)) issues.push("operation_id");
	const edits = Array.isArray(input.edits) ? input.edits : [];
	if (edits.length < 1 || edits.length > TRANSCRIPT_EDIT_LIMITS.edits)
		issues.push("edits");

	const seen = new Set<string>();
	for (const edit of edits) {
		if (
			!Number.isSafeInteger(edit.trackNumber) ||
			edit.trackNumber < 1 ||
			edit.trackNumber > 9999
		)
			issues.push("track_number");
		if (!validText(edit.segmentId, TRANSCRIPT_EDIT_LIMITS.segmentId))
			issues.push("segment_id");
		if (!validText(edit.speaker, TRANSCRIPT_EDIT_LIMITS.speaker))
			issues.push("speaker");
		if (!validText(edit.text, TRANSCRIPT_EDIT_LIMITS.text))
			issues.push("text");

		const identity = `${edit.trackNumber}\u0000${edit.segmentId}`;
		if (seen.has(identity)) issues.push("duplicate_segment");
		seen.add(identity);
	}

	return [...new Set(issues)];
}
