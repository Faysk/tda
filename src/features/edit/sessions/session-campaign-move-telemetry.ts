export type SessionCampaignMoveTelemetryStage =
	| "preflight"
	| "prepare"
	| "commit"
	| "cache";

export type SessionCampaignMoveTelemetryOutcome =
	| "ready"
	| "blocked"
	| "prepared"
	| "moved"
	| "replay"
	| "cache_pending"
	| "success"
	| "forbidden"
	| "not_found"
	| "conflict"
	| "operation_conflict"
	| "decision_required"
	| "preparation_required"
	| "preparation_conflict"
	| "cover_unverified"
	| "dependency_unavailable"
	| "validation"
	| "error";

export type SessionCampaignMoveTelemetryInput = Readonly<{
	stage: SessionCampaignMoveTelemetryStage;
	outcome: SessionCampaignMoveTelemetryOutcome;
	preparedAssets?: number;
}>;

const OUTCOMES = new Set<SessionCampaignMoveTelemetryOutcome>([
	"ready",
	"blocked",
	"prepared",
	"moved",
	"replay",
	"cache_pending",
	"success",
	"forbidden",
	"not_found",
	"conflict",
	"operation_conflict",
	"decision_required",
	"preparation_required",
	"preparation_conflict",
	"cover_unverified",
	"dependency_unavailable",
	"validation",
	"error",
]);

export function sessionCampaignMoveTelemetryOutcome(
	value: unknown,
): SessionCampaignMoveTelemetryOutcome {
	return typeof value === "string" && OUTCOMES.has(value as SessionCampaignMoveTelemetryOutcome)
		? (value as SessionCampaignMoveTelemetryOutcome)
		: "error";
}

export function sessionCampaignMoveTelemetryEvent(
	input: SessionCampaignMoveTelemetryInput,
) {
	const event: {
		schema: "tda.session-campaign-move.v1";
		event: "session_campaign_move";
		stage: SessionCampaignMoveTelemetryStage;
		outcome: SessionCampaignMoveTelemetryOutcome;
		contractVersion: 2;
		preparedAssets?: number;
	} = {
		schema: "tda.session-campaign-move.v1",
		event: "session_campaign_move",
		stage: input.stage,
		outcome: input.outcome,
		contractVersion: 2,
	};

	const preparedAssets = input.preparedAssets;
	if (
		typeof preparedAssets === "number" &&
		Number.isSafeInteger(preparedAssets) &&
		preparedAssets >= 0
	) {
		event.preparedAssets = preparedAssets;
	}
	return event;
}

export function logSessionCampaignMoveTelemetry(
	input: SessionCampaignMoveTelemetryInput,
) {
	console.info(JSON.stringify(sessionCampaignMoveTelemetryEvent(input)));
}
