import type { ManageableCampaign } from "@/features/campaigns/model";
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
	campaigns: readonly LembraCampaignClassification[],
	currentCampaignId: string | null,
	created: ManageableCampaign,
): ReconciledLembraCampaign {
	if (created.visibility !== "public") {
		return {
			campaigns,
			campaignId: currentCampaignId,
			message:
				"A campanha foi criada como privada e não aparece como classificação do Lembra.",
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

	const classification: LembraCampaignClassification = {
		id: created.id,
		name: created.name,
		lifecycle: "active",
	};
	const next = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
	next.set(classification.id, classification);

	return {
		campaigns: sortCampaigns([...next.values()]),
		campaignId: classification.id,
		message: "Campanha criada e selecionada.",
	};
}
