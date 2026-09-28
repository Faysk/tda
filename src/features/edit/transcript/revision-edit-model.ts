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
	| "unsupported_field"
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
		if (
			Object.keys(candidate).some(
				(key) => !["segmentKey", "speaker", "text"].includes(key),
			)
		) {
			issues.push("unsupported_field");
		}
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


export type TranscriptRevisionEditPersistenceResult =
	| Readonly<{
			status: "updated" | "replay" | "no_change";
			revisionId: string;
			revisionNumber: number;
			currentRevisionId: string;
	  }>
	| Readonly<{
			status: "stale_current";
			currentRevisionId: string | null;
	  }>
	| Readonly<{
			status:
				| "operation_conflict"
				| "forbidden"
				| "not_found"
				| "invalid_base"
				| "invalid_change"
				| "invalid_payload"
				| "dependency_unavailable";
	  }>;

type AtomicTranscriptRevisionEditRow = Readonly<{
	status?: unknown;
	revision_id?: unknown;
	revision_number?: unknown;
	current_revision_id?: unknown;
}>;

function parseUuid(value: unknown): string | null {
	return typeof value === "string" && value.length >= 32 && value.length <= 40
		? value
		: null;
}

export function parseTranscriptRevisionEditResult(
	data: unknown,
): TranscriptRevisionEditPersistenceResult {
	if (!Array.isArray(data) || data.length !== 1)
		return { status: "dependency_unavailable" };

	const row = data[0] as AtomicTranscriptRevisionEditRow;
	const currentRevisionId = parseUuid(row.current_revision_id);
	switch (row.status) {
		case "updated":
		case "replay":
		case "no_change": {
			const revisionId = parseUuid(row.revision_id);
			const revisionNumber =
				typeof row.revision_number === "number" &&
				Number.isSafeInteger(row.revision_number) &&
				row.revision_number > 0
					? row.revision_number
					: null;
			return revisionId && revisionNumber && currentRevisionId
				? {
						status: row.status,
						revisionId,
						revisionNumber,
						currentRevisionId,
					}
				: { status: "dependency_unavailable" };
		}
		case "stale_current":
			return { status: "stale_current", currentRevisionId };
		case "operation_conflict":
		case "forbidden":
		case "not_found":
		case "invalid_base":
		case "invalid_change":
		case "invalid_payload":
			return { status: row.status };
		default:
			return { status: "dependency_unavailable" };
	}
}
