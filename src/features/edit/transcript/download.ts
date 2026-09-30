import {
	renderTranscriptMarkdown,
	transcriptMarkdownFilename,
	type TranscriptReaderSnapshot,
} from "./reader-contract";
import { renderTranscriptRoundTripMarkdown } from "./markdown-roundtrip";

export async function buildTranscriptDownload(input: {
	campaignSlug: string;
	title: string;
	sessionDate: string | null;
	arc: string | null;
	sourceSessionId: string;
	snapshot: TranscriptReaderSnapshot;
}) {
	const filename = transcriptMarkdownFilename(
		input.sessionDate,
		input.title,
		input.snapshot.revisionNumber,
	);
	const roundTripEligible =
		input.snapshot.source === "current_revision" &&
		Boolean(input.snapshot.revisionId) &&
		Boolean(input.snapshot.revisionNumber) &&
		input.snapshot.segments.every((segment) => Boolean(segment.sourceSegmentId));
	const body = roundTripEligible
		? await renderTranscriptRoundTripMarkdown({
				title: input.title,
				sessionDate: input.sessionDate,
				arc: input.arc,
				identity: {
					campaignSlug: input.campaignSlug,
					sourceSessionId: input.sourceSessionId,
					baseRevisionId: input.snapshot.revisionId as string,
					baseRevisionNumber: input.snapshot.revisionNumber as number,
				},
				snapshot: input.snapshot,
			})
		: renderTranscriptMarkdown(input);
	return {
		filename,
		body,
		headers: {
			"Cache-Control": "private, no-store",
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Content-Type": "text/markdown; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
			Vary: "Cookie",
		} as const,
	};
}

export type TranscriptDownloadAccessFailure =
	| "unauthenticated"
	| "forbidden"
	| "profile_unresolved"
	| "dependency_unavailable";

export function transcriptDownloadFailureStatus(
	reason: TranscriptDownloadAccessFailure,
): number {
	if (reason === "unauthenticated") return 401;
	if (reason === "dependency_unavailable") return 503;
	// Deliberately collapse authorization failures into not-found to avoid
	// cross-campaign/session disclosure.
	return 404;
}
