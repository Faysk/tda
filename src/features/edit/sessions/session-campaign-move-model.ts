export const SESSION_CAMPAIGN_MOVE_CONTRACT_V2 =
	"tda_session_campaign_move_v2" as const;

export type SessionCampaignMoveClassification =
	| "auto"
	| "historical"
	| "external_prepare"
	| "decision"
	| "hard_block";

export type SessionCampaignMoveOptions = Readonly<{
	publishedPolicy?: "unpublish";
	participantEntityPolicy?: "unlink";
	entityMentionPolicy?: "detach_from_session";
	canonPolicy?: "detach_entity_links";
	sessionGrantPolicy?: "preserve" | "revoke";
	legacyCoverPolicy?: "clear_current";
}>;

export type SessionCampaignMoveBlocker = Readonly<{
	code: string;
	count: number;
	message: string;
}>;

export type SessionCampaignMovePlanItem = Readonly<{
	code: string;
	family: string;
	classification: SessionCampaignMoveClassification;
	resolved: boolean;
	count: number;
	message: string;
	actionId: string | null;
	selectedPolicy: string | null;
}>;

export type SessionCampaignMovePreview = Readonly<{
	status: "ready" | "blocked";
	contractVersion: typeof SESSION_CAMPAIGN_MOVE_CONTRACT_V2;
	sessionId: string;
	sourceSessionId: string;
	sourceCampaignSlug: string;
	destinationCampaignSlug: string;
	blockers: readonly SessionCampaignMoveBlocker[];
	planItems: readonly SessionCampaignMovePlanItem[];
	consequences: readonly string[];
}>;

export type SessionCampaignMoveDestination = Readonly<{
	technicalSlug: string;
	routeKey: string;
	name: string;
}>;

export function sessionCampaignMoveConsequenceLabel(code: string): string {
	switch (code) {
		case "edit_url_changes":
			return "O deep link do Edit passa a usar a campanha de destino.";
		case "campaign_scope_changes":
			return "Leitura e futuras edições passam a obedecer o RBAC da campanha de destino.";
		case "cache_revalidation_required":
			return "Bibliotecas e superfícies públicas relacionadas serão revalidadas após o commit.";
		default:
			return code;
	}
}

export function sessionCampaignMovePlanHeading(
	classification: SessionCampaignMoveClassification,
): string {
	switch (classification) {
		case "auto":
			return "Pode acompanhar automaticamente";
		case "external_prepare":
			return "Preparo automático antes do commit";
		case "decision":
			return "Decisões explícitas";
		case "historical":
			return "Histórico preservado";
		case "hard_block":
			return "Bloqueadores manuais";
	}
}

export function sessionCampaignMoveOptionsKey(
	options: SessionCampaignMoveOptions,
): string {
	return JSON.stringify({
		publishedPolicy: options.publishedPolicy ?? null,
		participantEntityPolicy: options.participantEntityPolicy ?? null,
		entityMentionPolicy: options.entityMentionPolicy ?? null,
		canonPolicy: options.canonPolicy ?? null,
		sessionGrantPolicy: options.sessionGrantPolicy ?? null,
		legacyCoverPolicy: options.legacyCoverPolicy ?? null,
	});
}
