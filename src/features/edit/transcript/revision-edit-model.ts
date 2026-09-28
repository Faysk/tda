import type { TranscriptReaderSegment } from "./reader-contract";

export const TRANSCRIPT_REVISION_EDIT_LIMITS = {
	patches: 1000,
	speaker: 160,
	text: 100000,
	id: 320,
} as const;

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type TranscriptRevisionPatch = Readonly<{
	id: string;
	speaker: string;
	text: string;
}>;

export type TranscriptRevisionEditInput = Readonly<{
	sessionId: string;
	expectedCurrentTranscriptRevisionId: string;
	operationId: string;
	patches: readonly TranscriptRevisionPatch[];
}>;

export type TranscriptRevisionEditIssue =
	| "session_id"
	| "expected_current_revision_id"
	| "operation_id"
	| "patch_count"
	| "patch_id"
	| "duplicate_patch"
	| "speaker"
	| "text"
	| "null_character";

function scalarLength(value: string): number | null {
	let length = 0;
	for (const char of value) {
		const point = char.codePointAt(0);
		if (point === undefined || (point >= 0xd800 && point <= 0xdfff)) return null;
		length += 1;
	}
	return length;
}

export function validateTranscriptRevisionEditInput(
	input: TranscriptRevisionEditInput,
): readonly TranscriptRevisionEditIssue[] {
	const issues: TranscriptRevisionEditIssue[] = [];
	if (!UUID.test(input.sessionId)) issues.push("session_id");
	if (!UUID.test(input.expectedCurrentTranscriptRevisionId))
		issues.push("expected_current_revision_id");
	if (!UUID.test(input.operationId)) issues.push("operation_id");
	if (
		!Array.isArray(input.patches) ||
		input.patches.length < 1 ||
		input.patches.length > TRANSCRIPT_REVISION_EDIT_LIMITS.patches
	)
		issues.push("patch_count");

	const ids = new Set<string>();
	for (const patch of input.patches) {
		const idLength = scalarLength(patch.id);
		if (
			!patch.id ||
			idLength === null ||
			idLength > TRANSCRIPT_REVISION_EDIT_LIMITS.id
		)
			issues.push("patch_id");
		if (ids.has(patch.id)) issues.push("duplicate_patch");
		ids.add(patch.id);

		const speakerLength = scalarLength(patch.speaker);
		if (
			!patch.speaker.trim() ||
			speakerLength === null ||
			speakerLength > TRANSCRIPT_REVISION_EDIT_LIMITS.speaker
		)
			issues.push("speaker");

		const textLength = scalarLength(patch.text);
		if (
			!patch.text.trim() ||
			textLength === null ||
			textLength > TRANSCRIPT_REVISION_EDIT_LIMITS.text
		)
			issues.push("text");

		if (
			patch.id.includes("\u0000") ||
			patch.speaker.includes("\u0000") ||
			patch.text.includes("\u0000")
		)
			issues.push("null_character");
	}
	return [...new Set(issues)];
}

export function applyTranscriptRevisionPatches(
	segments: readonly TranscriptReaderSegment[],
	patches: readonly TranscriptRevisionPatch[],
): TranscriptReaderSegment[] {
	const patchMap = new Map(patches.map((patch) => [patch.id, patch]));
	const known = new Set(segments.map((segment) => segment.id));
	for (const patch of patches) {
		if (!known.has(patch.id))
			throw new Error("Transcript patch references an unknown segment");
	}
	return segments.map((segment) => {
		const patch = patchMap.get(segment.id);
		return patch
			? { ...segment, speaker: patch.speaker, text: patch.text }
			: { ...segment };
	});
}

export type TranscriptRebaseSummary = Readonly<{
	compatible: boolean;
	remoteChangedSegments: number;
	collisions: number;
}>;

export function summarizeTranscriptRebase(
	baseline: readonly TranscriptReaderSegment[],
	remote: readonly TranscriptReaderSegment[],
	patches: readonly TranscriptRevisionPatch[],
): TranscriptRebaseSummary {
	if (baseline.length !== remote.length)
		return { compatible: false, remoteChangedSegments: 0, collisions: 0 };

	const remoteById = new Map(remote.map((segment) => [segment.id, segment]));
	const baselineById = new Map(baseline.map((segment) => [segment.id, segment]));
	let remoteChangedSegments = 0;

	for (const original of baseline) {
		const next = remoteById.get(original.id);
		if (
			!next ||
			next.trackNumber !== original.trackNumber ||
			next.startMs !== original.startMs ||
			next.endMs !== original.endMs
		)
			return { compatible: false, remoteChangedSegments: 0, collisions: 0 };
		if (next.speaker !== original.speaker || next.text !== original.text)
			remoteChangedSegments += 1;
	}

	let collisions = 0;
	for (const patch of patches) {
		const original = baselineById.get(patch.id);
		const next = remoteById.get(patch.id);
		if (!original || !next)
			return { compatible: false, remoteChangedSegments: 0, collisions: 0 };

		const speakerCollision =
			patch.speaker !== original.speaker &&
			next.speaker !== original.speaker &&
			patch.speaker !== next.speaker;
		const textCollision =
			patch.text !== original.text &&
			next.text !== original.text &&
			patch.text !== next.text;
		if (speakerCollision || textCollision) collisions += 1;
	}

	return { compatible: true, remoteChangedSegments, collisions };
}


export function rebaseTranscriptPatches(
	baseline: readonly TranscriptReaderSegment[],
	remote: readonly TranscriptReaderSegment[],
	patches: readonly TranscriptRevisionPatch[],
): TranscriptRevisionPatch[] {
	const summary = summarizeTranscriptRebase(baseline, remote, patches);
	if (!summary.compatible)
		throw new Error("Transcript revisions are not structurally compatible");
	const baselineById = new Map(baseline.map((segment) => [segment.id, segment]));
	const remoteById = new Map(remote.map((segment) => [segment.id, segment]));
	const result: TranscriptRevisionPatch[] = [];
	for (const patch of patches) {
		const original = baselineById.get(patch.id);
		const next = remoteById.get(patch.id);
		if (!original || !next)
			throw new Error("Transcript rebase lost segment identity");
		const rebased = {
			id: patch.id,
			speaker:
				patch.speaker !== original.speaker ? patch.speaker : next.speaker,
			text: patch.text !== original.text ? patch.text : next.text,
		};
		if (rebased.speaker !== next.speaker || rebased.text !== next.text)
			result.push(rebased);
	}
	return result;
}
