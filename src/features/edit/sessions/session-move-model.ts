const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG = /^[A-Za-z0-9_-]{1,128}$/u;

export type SessionMoveBlocker =
	| "published_session"
	| "transcript_revision"
	| "editorial_draft"
	| "publication_history"
	| "session_media"
	| "review_or_canon"
	| "entity_linked_participant"
	| "session_evidence_or_lineage"
	| "session_scoped_access"
	| "destination_source_collision"
	| "invalid_target";

export type SessionCampaignMoveRequest = Readonly<{
	operationId: string;
	sessionId: string;
	sourceCampaignSlug: string;
	destinationCampaignSlug: string;
}>;

export function validateSessionCampaignMoveRequest(
	input: SessionCampaignMoveRequest,
): readonly string[] {
	const issues: string[] = [];
	if (!UUID.test(input.operationId)) issues.push("operation_id");
	if (!UUID.test(input.sessionId)) issues.push("session_id");
	if (!SLUG.test(input.sourceCampaignSlug)) issues.push("source_campaign");
	if (!SLUG.test(input.destinationCampaignSlug)) issues.push("destination_campaign");
	if (input.sourceCampaignSlug === input.destinationCampaignSlug)
		issues.push("same_campaign");
	return issues;
}

export function normalizeSessionMoveBlockers(
	value: unknown,
): readonly SessionMoveBlocker[] {
	if (!Array.isArray(value)) return [];
	const allowed = new Set<SessionMoveBlocker>([
		"published_session",
		"transcript_revision",
		"editorial_draft",
		"publication_history",
		"session_media",
		"review_or_canon",
		"entity_linked_participant",
		"session_evidence_or_lineage",
		"session_scoped_access",
		"destination_source_collision",
		"invalid_target",
	]);
	return [
		...new Set(
			value.filter(
				(item): item is SessionMoveBlocker =>
					typeof item === "string" && allowed.has(item as SessionMoveBlocker),
			),
		),
	];
}
