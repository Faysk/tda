export const IMPORT_VERSION = "tda_transcript_import_v1";
export const RECEIPT_VERSION = "tda_transcript_receipt_v1";
export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_SEGMENTS = 10_000;
export type ImportIdentity = Readonly<{
	campaignId: string;
	sessionId: string;
	sourceSystem: "local_companion";
	sourceSessionId: string;
	publicationId: string;
	transcriptSha256: string;
}>;
export type ImportReceipt = ImportIdentity &
	Readonly<{
		schemaVersion: typeof RECEIPT_VERSION;
		status: "committed";
		receiptId: string;
		segmentCount: number;
		committedAt: string;
	}>;
export type ImportSegment = Readonly<{
	sourceSegmentId: string;
	startMs: number;
	endMs: number;
	text: string;
	speakerName: string;
	trackKey: string;
}>;
export type PreparedImport = ImportIdentity &
	Readonly<{
		jobId: string;
		manifestSha256: string;
		segments: readonly ImportSegment[];
	}>;
export type ImportFailure =
	| "unauthenticated"
	| "forbidden"
	| "import_capability_undefined"
	| "invalid_payload"
	| "unsupported_version"
	| "too_large"
	| "hash_mismatch"
	| "synthetic_payload"
	| "not_found"
	| "conflict"
	| "dependency_unavailable";
export type ImportResult =
	| { ok: true; receipt: ImportReceipt }
	| { ok: false; reason: ImportFailure };
export const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const SHA256 = /^[0-9a-f]{64}$/u;

export function sameIdentity(a: ImportIdentity, b: ImportIdentity): boolean {
	return (
		a.campaignId === b.campaignId &&
		a.sessionId === b.sessionId &&
		a.sourceSystem === b.sourceSystem &&
		a.sourceSessionId === b.sourceSessionId &&
		a.publicationId === b.publicationId &&
		a.transcriptSha256 === b.transcriptSha256
	);
}

export function confirmedReceipt(
	value: unknown,
	expected: ImportIdentity,
	segmentCount: number,
): value is ImportReceipt {
	if (!value || typeof value !== "object") return false;
	const r = value as ImportReceipt;
	return (
		r.schemaVersion === RECEIPT_VERSION &&
		r.status === "committed" &&
		typeof r.receiptId === "string" &&
		UUID.test(r.receiptId) &&
		sameIdentity(r, expected) &&
		Number.isSafeInteger(r.segmentCount) &&
		r.segmentCount === segmentCount &&
		typeof r.committedAt === "string" &&
		Number.isFinite(Date.parse(r.committedAt))
	);
}
