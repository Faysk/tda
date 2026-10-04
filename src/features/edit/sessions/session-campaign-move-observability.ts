export type SessionCampaignMoveOperationalPhase =
	| "preflight"
	| "prepare"
	| "commit"
	| "cache";

export type SessionCampaignMoveOperationalOutcome =
	| "ready"
	| "blocked"
	| "prepared"
	| "moved"
	| "replay"
	| "cache_ok"
	| "cache_pending"
	| "failed";

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const REASONS = new Set([
	"forbidden",
	"profile_unresolved",
	"conflict",
	"operation_conflict",
	"decision_required",
	"preparation_required",
	"preparation_conflict",
	"cover_unverified",
	"blocked",
	"not_found",
	"validation",
	"dependency_unavailable",
]);

export type SessionCampaignMoveOperationalInput = Readonly<{
	phase: SessionCampaignMoveOperationalPhase;
	outcome: SessionCampaignMoveOperationalOutcome;
	operationId?: string | null;
	reason?: string | null;
	contractVersion?: number | null;
	preparedAssets?: number | null;
}>;

export function sessionCampaignMoveOperationalRecord(
	input: SessionCampaignMoveOperationalInput,
) {
	const record: Record<string, string | number> = {
		schema: "tda.session-campaign-move.operation.v1",
		phase: input.phase,
		outcome: input.outcome,
	};

	if (input.operationId && UUID.test(input.operationId)) {
		record.operationId = input.operationId.toLowerCase();
	}
	if (
		Number.isSafeInteger(input.contractVersion) &&
		Number(input.contractVersion) >= 1 &&
		Number(input.contractVersion) <= 32
	) {
		record.contractVersion = Number(input.contractVersion);
	}
	if (
		Number.isSafeInteger(input.preparedAssets) &&
		Number(input.preparedAssets) >= 0 &&
		Number(input.preparedAssets) <= 1000
	) {
		record.preparedAssets = Number(input.preparedAssets);
	}
	if (input.reason) {
		record.reason = REASONS.has(input.reason) ? input.reason : "unknown";
	}

	return Object.freeze(record);
}

export function logSessionCampaignMoveOperational(
	input: SessionCampaignMoveOperationalInput,
): void {
	console.info(JSON.stringify(sessionCampaignMoveOperationalRecord(input)));
}
