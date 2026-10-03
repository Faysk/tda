import "server-only";

import { readAuthorizedCampaigns } from "@/features/campaigns/authorized";
import { canManageCampaignRegistry } from "@/features/campaigns/policy";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import type { LembraCampaignClassification } from "./model";
import { loadLembraCampaignClassifications } from "./repository";

export type LembraCampaignContext = Readonly<{
	campaigns: readonly LembraCampaignClassification[];
	canManageCampaigns: boolean;
}>;

/**
 * Lembra stays a global authenticated library. Campaigns here are classification
 * metadata only: public classifications plus private classifications the current
 * actor may discover through the canonical campaign.edit.access policy.
 */
export async function loadLembraCampaignContext(
	authUserId: string,
): Promise<LembraCampaignContext> {
	const publicCampaigns = await loadLembraCampaignClassifications();
	const byId = new Map(publicCampaigns.map((campaign) => [campaign.id, campaign]));
	let canManageCampaigns = false;

	try {
		const context = await loadEditAccessContext(authUserId);
		if (!context?.profileId) {
			return { campaigns: [...byId.values()], canManageCampaigns };
		}
		canManageCampaigns = canManageCampaignRegistry(context);

		const discovered = await readAuthorizedCampaigns(
			context,
			EDIT_CAPABILITIES.campaignEditAccess,
			{ includeArchived: true },
		);
		if (discovered.ok) {
			for (const campaign of discovered.campaigns) {
				byId.set(campaign.id, {
					id: campaign.id,
					name: campaign.name,
					lifecycle: campaign.lifecycle,
				});
			}
		}
	} catch {
		// Private campaign metadata fails closed. Public classifications remain usable.
		canManageCampaigns = false;
	}

	const campaigns = [...byId.values()].sort((left, right) =>
		left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }),
	);
	return { campaigns, canManageCampaigns };
}

export async function resolveLembraCampaignSelection(
	authUserId: string,
	campaignId: string,
): Promise<LembraCampaignClassification | null> {
	const context = await loadLembraCampaignContext(authUserId);
	return context.campaigns.find((campaign) => campaign.id === campaignId) ?? null;
}
