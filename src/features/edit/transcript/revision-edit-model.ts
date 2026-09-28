import type { TranscriptReaderSegment } from "./reader-contract";

export const TRANSCRIPT_REVISION_EDIT_LIMITS = {
	patches: 10_000,
	id: 512,
	speaker: 160,
	text: 10_000,
} as const;

export type TranscriptRevisionEditPatch = Readonly<{
	id: string;
	speaker: string;
	text: string;
}>;

export type TranscriptRevisionEditIssue =
	| "patches_required"
	| "too_many_patches"
	| "patch_invalid"
	| "patch_duplicate"
	| "id_invalid"
	| "speaker_required"
	| "speaker_too_long"
	| "text_required"
	| "text_too_long";

export type PreparedTranscriptRevisionEdits =
	| Readonly<{
			ok: true;
			patches: readonly TranscriptRevisionEditPatch[];
	  }>
	| Readonly<{
			ok: false;
			issues: readonly TranscriptRevisionEditIssue[];
	  }>;

function scalarLength(value: string): number {
	return Array.from(value).length;
}

function clean(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function prepareTranscriptRevisionEdits(
	value: unknown,
): PreparedTranscriptRevisionEdits {
	if (!Array.isArray(value) || value.length === 0) {
		return { ok: false, issues: ["patches_required"] };
	}
	if (value.length > TRANSCRIPT_REVISION_EDIT_LIMITS.patches) {
		return { ok: false, issues: ["too_many_patches"] };
	}

	const issues: TranscriptRevisionEditIssue[] = [];
	const seen = new Set<string>();
	const patches: TranscriptRevisionEditPatch[] = [];
	const allowedKeys = new Set(["id", "speaker", "text"]);

	for (const raw of value) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			issues.push("patch_invalid");
			continue;
		}
		const row = raw as Record<string, unknown>;
		if (Object.keys(row).some((key) => !allowedKeys.has(key))) {
			issues.push("patch_invalid");
			continue;
		}

		const id = clean(row.id);
		const speaker = clean(row.speaker);
		const text = clean(row.text);

		if (
			!id ||
			scalarLength(id) > TRANSCRIPT_REVISION_EDIT_LIMITS.id ||
			id.includes("\u0000")
		) {
			issues.push("id_invalid");
		}
		if (!speaker) issues.push("speaker_required");
		if (scalarLength(speaker) > TRANSCRIPT_REVISION_EDIT_LIMITS.speaker) {
			issues.push("speaker_too_long");
		}
		if (!text) issues.push("text_required");
		if (scalarLength(text) > TRANSCRIPT_REVISION_EDIT_LIMITS.text) {
			issues.push("text_too_long");
		}
		if (speaker.includes("\u0000") || text.includes("\u0000")) {
			issues.push("patch_invalid");
		}
		if (id && seen.has(id)) issues.push("patch_duplicate");
		if (id) seen.add(id);

		patches.push({ id, speaker, text });
	}

	if (issues.length) {
		return { ok: false, issues: [...new Set(issues)] };
	}
	return { ok: true, patches };
}

export function applyTranscriptRevisionEdits(
	segments: readonly TranscriptReaderSegment[],
	patches: readonly TranscriptRevisionEditPatch[],
): TranscriptReaderSegment[] {
	const byId = new Map(patches.map((patch) => [patch.id, patch]));
	return segments.map((segment) => {
		const patch = byId.get(segment.id);
		return patch
			? {
					...segment,
					speaker: patch.speaker,
					text: patch.text,
				}
			: segment;
	});
}
