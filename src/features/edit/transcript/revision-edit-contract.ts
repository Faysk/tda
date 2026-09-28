import type { TranscriptReaderSegment } from "./reader-contract";

export const MAX_INLINE_TRANSCRIPT_EDITS = 10_000;
export const MAX_INLINE_TRANSCRIPT_EDIT_BYTES = 8 * 1024 * 1024;
export const MAX_INLINE_TRANSCRIPT_SPEAKER_CHARS = 160;
export const MAX_INLINE_TRANSCRIPT_TEXT_CHARS = 100_000;

export type TranscriptRevisionEdit = Readonly<{
	trackNumber: number;
	segmentId: string;
	speaker: string;
	text: string;
}>;

export type PreparedTranscriptRevisionEdits =
	| Readonly<{ ok: true; value: readonly TranscriptRevisionEdit[] }>
	| Readonly<{
			ok: false;
			reason:
				| "invalid_edits"
				| "too_many_edits"
				| "payload_too_large";
	  }>;

function unicodeLength(value: string): number {
	return Array.from(value).length;
}

export function revisionSegmentId(
	segment: TranscriptReaderSegment,
): string | null {
	const prefix = `r-${segment.trackNumber}-`;
	if (!segment.id.startsWith(prefix)) return null;
	const value = segment.id.slice(prefix.length);
	return value && unicodeLength(value) <= 256 ? value : null;
}

export function prepareTranscriptRevisionEdits(
	input: readonly TranscriptRevisionEdit[],
): PreparedTranscriptRevisionEdits {
	if (input.length > MAX_INLINE_TRANSCRIPT_EDITS)
		return { ok: false, reason: "too_many_edits" };

	const seen = new Set<string>();
	const value: TranscriptRevisionEdit[] = [];
	for (const edit of input) {
		const speaker = edit.speaker.trim();
		const text = edit.text.trim();
		if (
			!Number.isSafeInteger(edit.trackNumber) ||
			edit.trackNumber < 1 ||
			edit.trackNumber > 9999 ||
			typeof edit.segmentId !== "string" ||
			!edit.segmentId ||
			unicodeLength(edit.segmentId) > 256 ||
			!speaker ||
			unicodeLength(speaker) > MAX_INLINE_TRANSCRIPT_SPEAKER_CHARS ||
			!text ||
			unicodeLength(text) > MAX_INLINE_TRANSCRIPT_TEXT_CHARS
		) {
			return { ok: false, reason: "invalid_edits" };
		}
		const key = `${edit.trackNumber}\u0000${edit.segmentId}`;
		if (seen.has(key)) return { ok: false, reason: "invalid_edits" };
		seen.add(key);
		value.push({
			trackNumber: edit.trackNumber,
			segmentId: edit.segmentId,
			speaker,
			text,
		});
	}

	const payload = JSON.stringify(value);
	if (new TextEncoder().encode(payload).byteLength > MAX_INLINE_TRANSCRIPT_EDIT_BYTES)
		return { ok: false, reason: "payload_too_large" };

	return { ok: true, value };
}

export function toRevisionEdit(
	segment: TranscriptReaderSegment,
	speaker: string,
	text: string,
): TranscriptRevisionEdit | null {
	const segmentId = revisionSegmentId(segment);
	if (!segmentId) return null;
	return {
		trackNumber: segment.trackNumber,
		segmentId,
		speaker,
		text,
	};
}
