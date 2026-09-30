import type {
	SessionAssembly,
	SessionAssemblyReviewSegment,
	SessionAssemblyReviewSummary,
} from "@/features/edit/processing/session-composer-protocol";
import type {
	TranscriptMarkdownBase,
	TranscriptMarkdownImport,
	TranscriptMarkdownSegment,
} from "./markdown-contract";

export function sessionAssemblyMarkdownBase(
	assembly: SessionAssembly,
	review: SessionAssemblyReviewSummary,
): TranscriptMarkdownBase {
	if (
		assembly.assemblyId !== review.assemblyId ||
		assembly.transcriptSha256 !== review.baseTranscriptSha256
	)
		throw new Error("SESSION_ASSEMBLY_REVIEW_BASE_MISMATCH");
	return {
		sessionId: assembly.sessionId,
		baseKind: "session_assembly",
		baseId: assembly.assemblyId,
		baseRevision: review.draftRevision,
		baseSha256: review.draftSha256 ?? review.baseTranscriptSha256,
	};
}

export function sessionAssemblyMarkdownSegments(
	segments: readonly SessionAssemblyReviewSegment[],
): readonly TranscriptMarkdownSegment[] {
	return segments.map((segment) => ({
		id: segment.assemblySegmentId,
		startMs: Math.round(segment.start * 1000),
		endMs: Math.round(segment.end * 1000),
		...(segment.absoluteTime === undefined
			? {}
			: { absoluteTime: segment.absoluteTime }),
		speaker: segment.speaker,
		text: segment.text,
	}));
}

export function applySessionAssemblyMarkdownImport(
	segments: readonly SessionAssemblyReviewSegment[],
	result: TranscriptMarkdownImport,
): readonly SessionAssemblyReviewSegment[] {
	const imported = new Map(result.segments.map((segment) => [segment.id, segment]));
	if (imported.size !== segments.length)
		throw new Error("SESSION_ASSEMBLY_MARKDOWN_SEGMENT_MISMATCH");
	return segments.map((segment) => {
		const next = imported.get(segment.assemblySegmentId);
		if (!next) throw new Error("SESSION_ASSEMBLY_MARKDOWN_SEGMENT_MISMATCH");
		return {
			...segment,
			speaker: next.speaker,
			text: next.text,
			reviewed: true,
		};
	});
}
