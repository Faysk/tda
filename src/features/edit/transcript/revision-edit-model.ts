export type TranscriptRevisionEditChange = Readonly<{
	segmentKey: string;
	speaker: string;
	text: string;
}>;

export type PreparedTranscriptRevisionEdit = Readonly<{
	changes: readonly TranscriptRevisionEditChange[];
}>;

export type TranscriptRevisionEditIssue =
	| "changes_required"
	| "too_many_changes"
	| "segment_key_invalid"
	| "duplicate_segment"
	| "speaker_required"
	| "speaker_too_long"
	| "text_required"
	| "text_too_long";

const SEGMENT_KEY_PATTERN = /^r-[1-9][0-9]{0,3}-.{1,280}$/u;
const MAX_CHANGES = 100_000;
const MAX_SPEAKER_SCALARS = 160;
const MAX_TEXT_SCALARS = 100_000;

function scalarLength(value: string): number {
	return Array.from(value).length;
}

export function prepareTranscriptRevisionEditChanges(
	input: unknown,
):
	| Readonly<{ ok: true; value: PreparedTranscriptRevisionEdit }>
	| Readonly<{ ok: false; issues: readonly TranscriptRevisionEditIssue[] }> {
	if (!Array.isArray(input) || input.length === 0) {
		return { ok: false, issues: ["changes_required"] };
	}
	if (input.length > MAX_CHANGES) {
		return { ok: false, issues: ["too_many_changes"] };
	}

	const issues: TranscriptRevisionEditIssue[] = [];
	const seen = new Set<string>();
	const changes: TranscriptRevisionEditChange[] = [];

	for (const raw of input) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			issues.push("segment_key_invalid");
			continue;
		}
		const candidate = raw as Record<string, unknown>;
		const segmentKey =
			typeof candidate.segmentKey === "string" ? candidate.segmentKey : "";
		const speaker =
			typeof candidate.speaker === "string" ? candidate.speaker.trim() : "";
		const text = typeof candidate.text === "string" ? candidate.text.trim() : "";

		if (!SEGMENT_KEY_PATTERN.test(segmentKey) || scalarLength(segmentKey) > 300) {
			issues.push("segment_key_invalid");
		} else if (seen.has(segmentKey)) {
			issues.push("duplicate_segment");
		} else {
			seen.add(segmentKey);
		}

		if (!speaker) issues.push("speaker_required");
		else if (scalarLength(speaker) > MAX_SPEAKER_SCALARS)
			issues.push("speaker_too_long");

		if (!text) issues.push("text_required");
		else if (scalarLength(text) > MAX_TEXT_SCALARS) issues.push("text_too_long");

		changes.push({ segmentKey, speaker, text });
	}

	return issues.length
		? { ok: false, issues: [...new Set(issues)] }
		: { ok: true, value: { changes } };
}
