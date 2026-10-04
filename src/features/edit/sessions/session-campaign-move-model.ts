export type SessionCampaignMoveBlocker = Readonly<{
	code: string;
	count: number;
	message: string;
}>;

export type SessionCampaignMovePlanClassification =
	| "auto"
	| "historical"
	| "external_prepare"
	| "decision";

export type SessionCampaignMovePlanItem = Readonly<{
	family: string;
	classification: SessionCampaignMovePlanClassification;
	count: number;
	message: string;
	action: string | null;
}>;

export type SessionCampaignMoveDecisionState = Readonly<{
	unlinkParticipantEntities: boolean;
	revokeSessionGrants: boolean;
}>;

export const EMPTY_SESSION_CAMPAIGN_MOVE_DECISIONS: SessionCampaignMoveDecisionState = {
	unlinkParticipantEntities: false,
	revokeSessionGrants: false,
};

export type SessionCampaignMovePreview = Readonly<{
	status: "ready" | "blocked";
	contractVersion: 2;
	sessionId: string;
	sourceSessionId: string;
	sourceCampaignSlug: string;
	destinationCampaignSlug: string;
	blockers: readonly SessionCampaignMoveBlocker[];
	plan: readonly SessionCampaignMovePlanItem[];
	consequences: readonly string[];
}>;

export type SessionCampaignMoveDestination = Readonly<{
	technicalSlug: string;
	routeKey: string;
	name: string;
}>;

export type SessionCampaignMoveRecoveryIntent = Readonly<{
	version: 1;
	sessionId: string;
	sourceSessionId: string;
	sourceCampaignSlug: string;
	destinationCampaignSlug: string;
	operationId: string;
}>;

export function sessionCampaignMoveConsequenceLabel(code: string): string {
	switch (code) {
		case "edit_url_changes":
			return "O deep link do Edit passa a usar a campanha de destino.";
		case "campaign_scope_changes":
			return "Leitura e futuras edições passam a obedecer o RBAC da campanha de destino.";
		case "public_route_changes":
			return "Se a sessão estiver publicada, a rota canônica passa a pertencer à campanha de destino.";
		case "cache_revalidation_required":
			return "Bibliotecas e superfícies públicas relacionadas serão revalidadas após o commit.";
		default:
			return code;
	}
}

export function sessionCampaignMovePlanHeading(
	classification: SessionCampaignMovePlanClassification,
): string {
	switch (classification) {
		case "auto":
			return "Acompanha automaticamente";
		case "historical":
			return "Permanece como histórico";
		case "external_prepare":
			return "Preparação antes do commit";
		case "decision":
			return "Precisa da sua confirmação";
	}
}

export function requiredSessionCampaignMoveDecisions(
	preview: SessionCampaignMovePreview | null,
): Readonly<{ unlinkParticipantEntities: boolean; revokeSessionGrants: boolean }> {
	const actions = new Set(
		(preview?.plan ?? [])
			.filter((item) => item.classification === "decision")
			.map((item) => item.action),
	);
	return {
		unlinkParticipantEntities: actions.has("unlink_participant_entities"),
		revokeSessionGrants: actions.has("revoke_session_grants"),
	};
}

export function validSessionCampaignMoveRecoveryIntent(
	value: unknown,
): value is SessionCampaignMoveRecoveryIntent {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	return (
		row.version === 1 &&
		typeof row.sessionId === "string" &&
		typeof row.sourceSessionId === "string" &&
		typeof row.sourceCampaignSlug === "string" &&
		typeof row.destinationCampaignSlug === "string" &&
		typeof row.operationId === "string"
	);
}
