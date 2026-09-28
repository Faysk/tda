import { createHash } from "node:crypto";
import type { TranscriptReaderSegment } from "./reader-contract";

function utf8Length(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

/**
 * Cross-language legacy snapshot identity shared with
 * prepare_legacy_transcript_revision_atomic.
 *
 * The length-prefixed UTF-8 material makes separators inside speaker/text
 * unambiguous while preserving the exact visible bytes and millisecond timing.
 */
export function legacyTranscriptSnapshotSha256(
	segments: readonly TranscriptReaderSegment[],
): string {
	const hash = createHash("sha256");
	for (const segment of segments) {
		const segmentId = segment.sourceSegmentId;
		if (!segmentId) throw new Error("Legacy transcript segment identity is missing");
		hash.update(
			[
				String(segment.trackNumber),
				String(utf8Length(segmentId)),
				segmentId,
				String(segment.startMs),
				String(segment.endMs),
				String(utf8Length(segment.speaker)),
				segment.speaker,
				String(utf8Length(segment.text)),
				segment.text,
			].join(":") + "\n",
			"utf8",
		);
	}
	return hash.digest("hex");
}
