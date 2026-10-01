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
	campaignSlug: string;
	sessionId: string;
	expectedRevision: number;
	baseTranscriptRevisionId: string;
	coverAssetId: string;
	arc: string;
	title: string;
	shortDescription: string;
	fullSummary: string;
	sessionDate: string;
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

export function isCanonicalSessionDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) return false;
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

function invalidLength(value: string, maximum: number): boolean {
	const length = sessionDraftScalarLength(value);
	return length === null || length > maximum;
}

export function validateSessionEditorialDraftInput(
	input: SessionEditorialDraftInput,
): readonly string[] {
	const issues: string[] = [];
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.campaignSlug))
		issues.push("campaign_slug");
	if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
		issues.push("expected_revision");
	if (!input.baseTranscriptRevisionId) issues.push("base_transcript_revision");
	if (input.sessionDate && !isCanonicalSessionDate(input.sessionDate))
		issues.push("session_date");
	if (invalidLength(input.coverAssetId, SESSION_DRAFT_LIMITS.coverAssetId))
		issues.push("cover_asset_id_too_long");
	if (invalidLength(input.arc, SESSION_DRAFT_LIMITS.arc)) issues.push("arc_too_long");
	if (invalidLength(input.title, SESSION_DRAFT_LIMITS.title)) issues.push("title_too_long");
	if (invalidLength(input.shortDescription, SESSION_DRAFT_LIMITS.shortDescription))
		issues.push("short_description_too_long");
	if (invalidLength(input.fullSummary, SESSION_DRAFT_LIMITS.fullSummary))
		issues.push("full_summary_too_long");
	if (
		[
			input.coverAssetId,
			input.arc,
			input.title,
			input.shortDescription,
			input.fullSummary,
			input.sessionDate,
		].some(
			(value) => value.includes("\u0000"),
		)
	)
		issues.push("null_character");
	return issues;
}

export function sessionDraftReadiness(
	draft: Pick<
		SessionEditorialDraft,
		"coverAssetId" | "title" | "shortDescription" | "fullSummary" | "sessionDate"
	>,
): readonly string[] {
	const missing: string[] = [];
	if (!draft.coverAssetId.trim()) missing.push("capa");
	if (!draft.sessionDate || !isCanonicalSessionDate(draft.sessionDate))
		missing.push("data da sessão");
	if (!draft.title.trim()) missing.push("título");
	if (!draft.shortDescription.trim()) missing.push("descrição curta");
	if (!draft.fullSummary.trim()) missing.push("resumo completo");
	return missing;
}
