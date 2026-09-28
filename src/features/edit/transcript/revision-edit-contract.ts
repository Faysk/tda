import {
	normalizeRevisionSegments,
	type TranscriptReaderSegment,
} from "./reader-contract";

export const TRANSCRIPT_REVISION_EDIT_LIMITS = {
	speaker: 160,
	text: 100000,
	patches: 100000,
} as const;

export type TranscriptRevisionEditPatch = Readonly<{
	id: string;
	speaker: string;
	text: string;
}>;

export type TranscriptRevisionEditInput = Readonly<{
	sessionId: string;
	expectedCurrentRevisionId: string;
	operationId: string;
	patches: readonly TranscriptRevisionEditPatch[];
}>;

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function validateTranscriptRevisionEditInput(
	input: TranscriptRevisionEditInput,
): string[] {
	const issues: string[] = [];
	if (!UUID.test(input.sessionId)) issues.push("session_id");
	if (!UUID.test(input.expectedCurrentRevisionId))
		issues.push("expected_current_revision_id");
	if (!UUID.test(input.operationId)) issues.push("operation_id");
	if (!Array.isArray(input.patches) || input.patches.length > TRANSCRIPT_REVISION_EDIT_LIMITS.patches)
		issues.push("patches");

	const ids = new Set<string>();
	for (const patch of input.patches) {
		if (
			!patch ||
			typeof patch.id !== "string" ||
			patch.id.length < 1 ||
			patch.id.length > 512 ||
			ids.has(patch.id)
		) {
			issues.push("patch_id");
			continue;
		}
		ids.add(patch.id);
		if (
			typeof patch.speaker !== "string" ||
			!patch.speaker.trim() ||
			patch.speaker.length > TRANSCRIPT_REVISION_EDIT_LIMITS.speaker
		)
			issues.push("speaker");
		if (
			typeof patch.text !== "string" ||
			!patch.text.trim() ||
			patch.text.length > TRANSCRIPT_REVISION_EDIT_LIMITS.text
		)
			issues.push("text");
	}
	return [...new Set(issues)];
}

function rawSegmentIdentity(value: unknown): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;
	if (!Number.isSafeInteger(row.track_number) || typeof row.segment_id !== "string")
		return null;
	return `r-${Number(row.track_number)}-${row.segment_id}`;
}

export function applyTranscriptRevisionPatches(
	rawSegments: unknown,
	patches: readonly TranscriptRevisionEditPatch[],
):
	| Readonly<{
			ok: true;
			segments: readonly Record<string, unknown>[];
			changed: number;
			normalized: readonly TranscriptReaderSegment[];
	  }>
	| Readonly<{ ok: false; reason: "invalid_revision" | "unknown_segment" }> {
	let normalized: TranscriptReaderSegment[];
	try {
		normalized = normalizeRevisionSegments(rawSegments);
	} catch {
		return { ok: false, reason: "invalid_revision" };
	}
	if (!Array.isArray(rawSegments)) return { ok: false, reason: "invalid_revision" };

	const validIds = new Set(normalized.map((segment) => segment.id));
	const patchMap = new Map(patches.map((patch) => [patch.id, patch] as const));
	if ([...patchMap.keys()].some((id) => !validIds.has(id)))
		return { ok: false, reason: "unknown_segment" };

	let changed = 0;
	const segments = rawSegments.map((value) => {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error("normalized revision unexpectedly contains an invalid segment");
		const row = value as Record<string, unknown>;
		const identity = rawSegmentIdentity(row);
		const patch = identity ? patchMap.get(identity) : undefined;
		if (!patch) return { ...row };
		if (row.speaker === patch.speaker && row.text === patch.text) return { ...row };
		changed += 1;
		return { ...row, speaker: patch.speaker, text: patch.text };
	});
	return { ok: true, segments, changed, normalized };
}
