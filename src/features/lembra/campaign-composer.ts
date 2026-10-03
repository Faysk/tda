import type { LembraCampaignClassification } from "./model";

export type ReconciledLembraCampaign = Readonly<{
	campaigns: readonly LembraCampaignClassification[];
	campaignId: string | null;
	message: string;
}>;

function sortCampaigns(
	campaigns: readonly LembraCampaignClassification[],
): LembraCampaignClassification[] {
	return [...campaigns].sort(
		(a, b) =>
			a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id),
	);
}

export function reconcileCreatedLembraCampaign(
	projectedCampaigns: readonly LembraCampaignClassification[],
	currentCampaignId: string | null,
	createdCampaignId: string,
): ReconciledLembraCampaign {
	const campaigns = sortCampaigns(projectedCampaigns);
	const created = campaigns.find((campaign) => campaign.id === createdCampaignId);

	if (!created) {
		return {
			campaigns,
			campaignId: currentCampaignId,
			message:
				"A campanha foi criada, mas não está disponível para classificar referências neste acesso.",
		};
	}

	if (created.lifecycle !== "active") {
		return {
			campaigns,
			campaignId: currentCampaignId,
			message:
				"A campanha foi criada, mas não está ativa para classificar novas referências.",
		};
	}

	return {
		campaigns,
		campaignId: created.id,
		message: "Campanha criada e selecionada.",
	};
}
