export type SessionCampaignMoveBlocker = Readonly<{
	code: string;
	count: number;
	message: string;
}>;

export type SessionCampaignMovePreview = Readonly<{
	status: "ready" | "blocked";
	sessionId: string;
	sourceSessionId: string;
	sourceCampaignSlug: string;
	destinationCampaignSlug: string;
	blockers: readonly SessionCampaignMoveBlocker[];
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
