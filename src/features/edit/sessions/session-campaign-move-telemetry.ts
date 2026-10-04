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

	if (
		Number.isSafeInteger(input.preparedAssets) &&
		(input.preparedAssets ?? -1) >= 0
	) {
		event.preparedAssets = input.preparedAssets;
	}
	return event;
}

export function logSessionCampaignMoveTelemetry(
	input: SessionCampaignMoveTelemetryInput,
) {
	console.info(JSON.stringify(sessionCampaignMoveTelemetryEvent(input)));
}
