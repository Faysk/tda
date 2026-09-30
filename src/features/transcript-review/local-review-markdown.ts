import type { LocalReview, LocalReviewSegment } from "@/features/edit/processing/protocol";
import type {
	TranscriptMarkdownBase,
	TranscriptMarkdownImport,
	TranscriptMarkdownSegment,
} from "./markdown-contract";

export function localReviewMarkdownBase(review: LocalReview): TranscriptMarkdownBase {
	return {
		sessionId: review.publicationTarget?.sourceSessionId ?? review.sourceId,
		baseKind: "local_run",
		baseId: review.sourceId + "/" + review.runId,
		baseRevision: review.draftRevision,
		baseSha256:
			review.persistence === "persisted" && review.draftSha256
				? review.draftSha256
				: review.baseTranscriptSha256,
	};
}

export function localReviewMarkdownSegmentId(
	segment: Pick<LocalReviewSegment, "trackNumber" | "segmentId">,
): string {
	return "track:" + segment.trackNumber + ":segment:" + encodeURIComponent(segment.segmentId);
}

export function localReviewMarkdownSegments(
	review: Pick<LocalReview, "segments">,
): TranscriptMarkdownSegment[] {
	return review.segments.map((segment) => ({
		id: localReviewMarkdownSegmentId(segment),
		startMs: Math.round((segment.timelineStart ?? segment.start) * 1000),
		endMs: Math.round((segment.timelineEnd ?? segment.end) * 1000),
		...(segment.absoluteTime !== undefined ? { absoluteTime: segment.absoluteTime } : {}),
		speaker: segment.speaker,
		text: segment.text,
	}));
}

export function applyLocalReviewMarkdownImport(
	current: readonly LocalReviewSegment[],
	imported: TranscriptMarkdownImport,
): LocalReviewSegment[] {
	const edits = new Map(imported.segments.map((segment) => [segment.id, segment] as const));
	return current.map((segment) => {
		const edit = edits.get(localReviewMarkdownSegmentId(segment));
		return edit
			? {
					...segment,
					speaker: edit.speaker,
					text: edit.text,
				}
			: { ...segment };
	});
}
