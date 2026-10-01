import "server-only";

import { readAuthorizedCampaigns } from "@/features/campaigns/authorized";
import { readCampaignRegistry } from "@/features/campaigns/repository";
import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
	type EditCapability,
} from "@/features/edit/access/policy";
import { LEGACY_CAMPAIGN_TECHNICAL_SLUG } from "@/features/sessions/model";

const NAVIGATION_TOOL_CAPABILITIES = [
	EDIT_CAPABILITIES.transcriptRead,
	EDIT_CAPABILITIES.localProcess,
	EDIT_CAPABILITIES.worldLayoutEdit,
	EDIT_CAPABILITIES.reviewRead,
	EDIT_CAPABILITIES.permissionsManage,
] as const satisfies readonly EditCapability[];

export type NavigationCampaign = Readonly<{
	technicalSlug: string;
	routeKey: string;
	name: string;
	lifecycle: "active";
	capabilities: readonly EditCapability[];
}>;

export type NavigationCampaignReadResult = Readonly<{
	mode: "first_class" | "unavailable";
	campaigns: readonly NavigationCampaign[];
}>;

/**
 * Projects the shared, server-authorized campaign directory into the minimal
 * global-navigation contract. Discovery and capability filtering stay on the
 * server; UUIDs and raw grants never enter the browser projection.
 */
export async function readNavigationCampaigns(
	context: EditAccessContext,
): Promise<NavigationCampaignReadResult> {
	const byCampaign = new Map<
		string,
		{ name: string; capabilities: EditCapability[] }
	>();

	for (const capability of NAVIGATION_TOOL_CAPABILITIES) {
		const result = await readAuthorizedCampaigns(context, capability);
		if (!result.ok) return { mode: "unavailable", campaigns: [] };

		for (const campaign of result.campaigns) {
			if (campaign.lifecycle !== "active") continue;
			// World/Review compatibility links are intentionally limited to the
			// historical campaign in this slice; sibling routes own their rollout.
			if (
				campaign.technicalSlug !== LEGACY_CAMPAIGN_TECHNICAL_SLUG &&
				(capability === EDIT_CAPABILITIES.worldLayoutEdit ||
					capability === EDIT_CAPABILITIES.reviewRead)
			) {
				continue;
			}

			const existing = byCampaign.get(campaign.technicalSlug);
			if (existing) {
				if (!existing.capabilities.includes(capability))
					existing.capabilities.push(capability);
				continue;
			}
			byCampaign.set(campaign.technicalSlug, {
				name: campaign.name,
				capabilities: [capability],
			});
		}
	}

	if (byCampaign.size === 0)
		return { mode: "first_class", campaigns: [] };

	const registry = await readCampaignRegistry();
	if (!registry) return { mode: "unavailable", campaigns: [] };
	const registryBySlug = new Map(
		registry
			.filter((campaign) => campaign.lifecycle === "active")
			.map((campaign) => [campaign.technicalSlug, campaign] as const),
	);

	const campaigns: NavigationCampaign[] = [];
	for (const [technicalSlug, projection] of byCampaign) {
		const registered = registryBySlug.get(technicalSlug);
		if (!registered) return { mode: "unavailable", campaigns: [] };
		campaigns.push({
			technicalSlug,
			routeKey: registered.routeKey,
			name: projection.name,
			lifecycle: "active",
			capabilities: projection.capabilities,
		});
	}

	campaigns.sort((left, right) =>
		left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }),
	);
	return { mode: "first_class", campaigns };
}
