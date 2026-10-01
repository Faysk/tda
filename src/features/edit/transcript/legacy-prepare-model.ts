const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;

export type LegacyTranscriptPrepareRequest = Readonly<{
	campaignSlug: string;
	sessionId: string;
	operationId: string;
	expectedSnapshotSha256: string;
}>;

export type LegacyTranscriptPrepareSuccess = Readonly<{
	ok: true;
	status: "prepared" | "replay" | "already_prepared";
	revisionId: string;
	revisionNumber: number;
	snapshotSha256: string;
	segmentCount: number;
}>;

export type LegacyTranscriptPrepareFailure = Readonly<{
	ok: false;
	reason:
		| "validation"
		| "forbidden"
		| "profile_unresolved"
		| "unauthenticated"
		| "dependency_unavailable"
		| "not_found"
		| "operation_conflict"
		| "stale_legacy"
		| "empty_legacy"
		| "invalid_legacy";
	issues: readonly string[];
	actualSnapshotSha256?: string | null;
	segmentCount?: number | null;
}>;

export type LegacyTranscriptPrepareResult =
	| LegacyTranscriptPrepareSuccess
	| LegacyTranscriptPrepareFailure;

export function validateLegacyTranscriptPrepareRequest(
	input: LegacyTranscriptPrepareRequest,
): readonly string[] {
	const issues: string[] = [];
	if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.campaignSlug))
		issues.push("campaign_slug");
	if (!UUID.test(input.sessionId)) issues.push("session_id");
	if (!UUID.test(input.operationId)) issues.push("operation_id");
	if (!SHA256.test(input.expectedSnapshotSha256))
		issues.push("expected_snapshot_sha256");
	return issues;
}
