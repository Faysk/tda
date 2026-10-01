export const SESSION_CAMPAIGN_MOVE_BLOCKERS = [
	"same_campaign",
	"destination_collision",
	"active_publication",
	"legacy_publication",
	"campaign_scoped_media",
	"participant_entity_links",
	"canon_or_entity_provenance",
	"session_scoped_grants",
] as const;

export type SessionCampaignMoveBlocker =
	(typeof SESSION_CAMPAIGN_MOVE_BLOCKERS)[number];

export type SessionCampaignMovePreviewRequest = Readonly<{
	sourceCampaignSlug: string;
	destinationCampaignSlug: string;
	sessionId: string;
	sourceSessionId: string;
}>;

export type SessionCampaignMoveCommitRequest =
	SessionCampaignMovePreviewRequest &
		Readonly<{
			expectedUpdatedAt: string;
			operationId: string;
		}>;

export type SessionCampaignMovePreview = Readonly<{
	sessionId: string;
	sourceSessionId: string;
	sourceCampaignId: string;
	sourceCampaignSlug: string;
	sourceCampaignName: string;
	destinationCampaignId: string;
	destinationCampaignSlug: string;
	destinationCampaignName: string;
	expectedUpdatedAt: string;
	blockers: readonly SessionCampaignMoveBlocker[];
	ready: boolean;
}>;

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function validateSessionCampaignMovePreviewRequest(
	input: SessionCampaignMovePreviewRequest,
): readonly string[] {
	const issues: string[] = [];
	if (!SLUG.test(input.sourceCampaignSlug)) issues.push("source_campaign");
	if (!SLUG.test(input.destinationCampaignSlug))
		issues.push("destination_campaign");
	if (!UUID.test(input.sessionId)) issues.push("session_id");
	if (
		typeof input.sourceSessionId !== "string" ||
		!input.sourceSessionId.trim() ||
		input.sourceSessionId.length > 220 ||
		input.sourceSessionId.includes("\u0000")
	) {
		issues.push("source_session_id");
	}
	return issues;
}

export function validateSessionCampaignMoveCommitRequest(
	input: SessionCampaignMoveCommitRequest,
): readonly string[] {
	const issues = [...validateSessionCampaignMovePreviewRequest(input)];
	if (!UUID.test(input.operationId)) issues.push("operation_id");
	const timestamp = Date.parse(input.expectedUpdatedAt);
	if (!Number.isFinite(timestamp)) issues.push("expected_updated_at");
	return [...new Set(issues)];
}

export function isSessionCampaignMoveBlocker(
	value: unknown,
): value is SessionCampaignMoveBlocker {
	return (
		typeof value === "string" &&
		(SESSION_CAMPAIGN_MOVE_BLOCKERS as readonly string[]).includes(value)
	);
}

export function sessionCampaignMoveBlockerMessage(
	blocker: SessionCampaignMoveBlocker,
): string {
	switch (blocker) {
		case "same_campaign":
			return "A sessão já pertence a esta campanha.";
		case "destination_collision":
			return "A campanha de destino já possui uma sessão com o mesmo identificador de origem. Resolva a identidade antes de mover.";
		case "active_publication":
			return "Existe uma publicação ativa. Despublique a sessão antes de mover para evitar quebrar a URL canônica.";
		case "legacy_publication":
			return "Existe uma publicação do contrato legado vinculada à sessão. Resolva ou retire essa publicação antes do move.";
		case "campaign_scoped_media":
			return "Há capa/mídia no namespace da campanha atual. A mídia precisa ser removida ou migrada pelo contrato de storage antes do move.";
		case "participant_entity_links":
			return "Participantes apontam para entidades da campanha atual. Remapeie ou remova esses vínculos explicitamente; o TDA não copia entidades por nome.";
		case "canon_or_entity_provenance":
			return "Há canon/provenance ligado a entidades desta campanha. Resolva esses vínculos antes do move; nada será clonado automaticamente.";
		case "session_scoped_grants":
			return "Existem permissões vinculadas diretamente à sessão/recurso. Reatribua ou revogue esses grants antes de mudar o escopo físico.";
	}
}
