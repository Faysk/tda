export type SessionPublicationState = Readonly<{
	currentPublicationId: string | null;
	version: number | null;
	sourceDraftId: string | null;
	payloadSha256: string | null;
	publishedAt: string | null;
	sessionStatus: string;
	sourceSessionId: string;
}>;

export type SessionPublicationRequest = Readonly<{
	sessionId: string;
	draftId: string;
	expectedCurrentPublicationId: string | null;
	operationId: string;
}>;

export type SessionPublicationSuccess = Readonly<{
	ok: true;
	replayed: boolean;
	operationId: string;
	publicationId: string;
	previousPublicationId: string | null;
	version: number;
	payloadSha256: string;
	state: SessionPublicationState;
}>;

export type SessionPublicationFailureReason =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "validation"
	| "not_production"
	| "not_found"
	| "draft_stale"
	| "transcript_stale"
	| "draft_incomplete"
	| "cover_not_verified"
	| "conflict"
	| "operation_conflict"
	| "dependency_unavailable";

export type SessionPublicationResult =
	| SessionPublicationSuccess
	| Readonly<{
			ok: false;
			reason: SessionPublicationFailureReason;
			state?: SessionPublicationState | null;
	  }>;

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;

export function validSessionPublicationRequest(
	input: SessionPublicationRequest,
): boolean {
	return (
		UUID.test(input.sessionId) &&
		UUID.test(input.draftId) &&
		UUID.test(input.operationId) &&
		(input.expectedCurrentPublicationId === null ||
			UUID.test(input.expectedCurrentPublicationId))
	);
}

export function validPublicationHash(value: unknown): value is string {
	return typeof value === "string" && SHA256.test(value);
}

export function shortPublicationId(value: string | null): string {
	return value ? value.slice(0, 8) + "…" : "nenhuma";
}
