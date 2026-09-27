export const SESSION_DRAFT_LIMITS = {
	arc: 300,
	title: 500,
	shortDescription: 4000,
	fullSummary: 200000,
	coverAssetId: 512,
} as const;

export type SessionEditorialDraft = Readonly<{
	draftId: string | null;
	revision: number;
	baseTranscriptRevisionId: string;
	currentTranscriptRevisionId: string;
	transcriptChanged: boolean;
	coverAssetId: string;
	arc: string;
	title: string;
	shortDescription: string;
	fullSummary: string;
	updatedAt: string | null;
	sessionStatus: string;
	sessionDate: string | null;
	seededFromPublished: boolean;
}>;

export type SessionEditorialDraftInput = Readonly<{
	sessionId: string;
	expectedRevision: number;
	baseTranscriptRevisionId: string;
	coverAssetId: string;
	arc: string;
	title: string;
	shortDescription: string;
	fullSummary: string;
}>;

export function sessionDraftScalarLength(value: string): number | null {
	let length = 0;
	for (const char of value) {
		const code = char.codePointAt(0);
		if (code === undefined || (code >= 0xd800 && code <= 0xdfff)) return null;
		length += 1;
	}
	return length;
}

function invalidLength(value: string, maximum: number): boolean {
	const length = sessionDraftScalarLength(value);
	return length === null || length > maximum;
}

export function validateSessionEditorialDraftInput(
	input: SessionEditorialDraftInput,
): readonly string[] {
	const issues: string[] = [];
	if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
		issues.push("expected_revision");
	if (!input.baseTranscriptRevisionId) issues.push("base_transcript_revision");
	if (invalidLength(input.coverAssetId, SESSION_DRAFT_LIMITS.coverAssetId))
		issues.push("cover_asset_id_too_long");
	if (invalidLength(input.arc, SESSION_DRAFT_LIMITS.arc)) issues.push("arc_too_long");
	if (invalidLength(input.title, SESSION_DRAFT_LIMITS.title)) issues.push("title_too_long");
	if (invalidLength(input.shortDescription, SESSION_DRAFT_LIMITS.shortDescription))
		issues.push("short_description_too_long");
	if (invalidLength(input.fullSummary, SESSION_DRAFT_LIMITS.fullSummary))
		issues.push("full_summary_too_long");
	if (
		[input.coverAssetId, input.arc, input.title, input.shortDescription, input.fullSummary].some(
			(value) => value.includes("\u0000"),
		)
	)
		issues.push("null_character");
	return issues;
}

export function sessionDraftReadiness(
	draft: Pick<
		SessionEditorialDraft,
		"coverAssetId" | "title" | "shortDescription" | "fullSummary"
	>,
): readonly string[] {
	const missing: string[] = [];
	if (!draft.coverAssetId.trim()) missing.push("capa");
	if (!draft.title.trim()) missing.push("título");
	if (!draft.shortDescription.trim()) missing.push("descrição curta");
	if (!draft.fullSummary.trim()) missing.push("resumo completo");
	return missing;
}
