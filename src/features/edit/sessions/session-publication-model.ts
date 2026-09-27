export type SessionPublicationConfirmation = Readonly<{
	sessionId: string;
	sourceSessionId: string;
	expectedCurrentPublicationId: string | null;
	currentVersionNumber: number | null;
	draftId: string;
	draftRevision: number;
	transcriptRevisionId: string;
	coverAssetId: string;
	coverState: "staged" | "verified_public";
	coverSha256: string;
	coverMimeType: "image/png" | "image/webp";
	coverBytes: number;
	coverWidth: number;
	coverHeight: number;
	coverStagedBucket: string;
	coverObjectKey: string;
	arc: string;
	title: string;
	shortDescriptionChars: number;
	fullSummaryChars: number;
}>;

export type SessionPublicationCommitInput = Readonly<{
	sessionId: string;
	operationId: string;
	expectedCurrentPublicationId: string | null;
	draftId: string;
	draftRevision: number;
	transcriptRevisionId: string;
	coverAssetId: string;
}>;

export type SessionPublicationReceipt = Readonly<{
	receiptId: string;
	sessionId: string;
	publicationId: string;
	versionNumber: number;
	operationId: string;
	payloadSha256: string;
	committedAt: string;
}>;

export function publicationIdentityToken(value: string): string {
	return new TextEncoder().encode(value).byteLength + "#" + value;
}

export function sessionPublicationIdentity(input: {
	sessionId: string;
	draftId: string;
	draftRevision: number;
	transcriptRevisionId: string;
	coverAssetId: string;
	coverPublicUrl: string;
	coverSha256: string;
	arc: string;
	title: string;
	summaryShort: string;
	summaryFull: string;
}): string {
	return (
		"tda_session_publication_payload_v1|" +
		[
			input.sessionId,
			input.draftId,
			String(input.draftRevision),
			input.transcriptRevisionId,
			input.coverAssetId,
			input.coverPublicUrl,
			input.coverSha256,
			input.arc,
			input.title,
			input.summaryShort,
			input.summaryFull,
		]
			.map(publicationIdentityToken)
			.join("")
	);
}
