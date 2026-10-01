const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SessionPublicationRequest = Readonly<{
	campaignSlug: string;
	sessionId: string;
	draftId: string;
	expectedCurrentPublicationId: string | null;
	operationId: string;
}>;

export type SessionPublicationState = Readonly<{
	currentPublicationId: string | null;
	currentVersion: number;
}>;

export type SessionPublicationReceipt = Readonly<{
	publicationId: string;
	version: number;
	previousPublicationId: string | null;
	payloadSha256: string;
	replayed: boolean;
	cachePending: boolean;
}>;

export function validateSessionPublicationRequest(
	input: SessionPublicationRequest,
): readonly string[] {
	const issues: string[] = [];
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.campaignSlug))
		issues.push("campaign_slug");
	if (!UUID_PATTERN.test(input.sessionId)) issues.push("session_id");
	if (!UUID_PATTERN.test(input.draftId)) issues.push("draft_id");
	if (!UUID_PATTERN.test(input.operationId)) issues.push("operation_id");
	if (
		input.expectedCurrentPublicationId !== null &&
		!UUID_PATTERN.test(input.expectedCurrentPublicationId)
	) {
		issues.push("expected_current_publication_id");
	}
	return issues;
}

export function isPublicationHash(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function isPublicationVersion(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value > 0
	);
}
