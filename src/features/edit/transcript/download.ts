import {
	renderTranscriptMarkdown,
	transcriptMarkdownFilename,
	type TranscriptReaderSnapshot,
} from "./reader-contract";

export async function buildTranscriptDownload(input: {
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
	return {
		filename,
		body: await renderTranscriptMarkdown(input),
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
