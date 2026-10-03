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


export function reconcileProjectedLembraCampaign(
	currentCampaigns: readonly LembraCampaignClassification[],
	currentCampaignId: string | null,
	created: ManageableCampaign,
	discoverableCampaigns: readonly LembraCampaignClassification[],
): ReconciledLembraCampaign {
	const projected = sortCampaigns(discoverableCampaigns);
	const createdProjection = projected.find((campaign) => campaign.id === created.id);
	const preservedCurrent = currentCampaignId
		? projected.some((campaign) => campaign.id === currentCampaignId)
			? currentCampaignId
			: null
		: null;

	if (!createdProjection) {
		return {
			campaigns: projected,
			campaignId: preservedCurrent,
			message:
				"A campanha foi criada, mas ainda não está disponível para classificação no Lembra.",
		};
	}

	if (createdProjection.lifecycle !== "active") {
		return {
			campaigns: projected,
			campaignId: preservedCurrent,
			message:
				"A campanha foi criada, mas não está ativa para classificar novas referências.",
		};
	}

	return {
		campaigns: projected,
		campaignId: createdProjection.id,
		message: "Campanha criada e selecionada.",
	};
}
