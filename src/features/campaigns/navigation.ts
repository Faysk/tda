import "server-only";

import { readAuthorizedCampaigns } from "@/features/campaigns/authorized";
import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
	type EditCapability,
} from "@/features/edit/access/policy";

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
	const result = await readAuthorizedCampaigns(
		context,
		NAVIGATION_TOOL_CAPABILITIES,
	);
	if (!result.ok) return { mode: "unavailable", campaigns: [] };

	const campaigns: NavigationCampaign[] = [];
	for (const campaign of result.campaigns) {
		const capabilities = campaign.capabilities;
		if (capabilities.length === 0) continue;
		campaigns.push({
			technicalSlug: campaign.technicalSlug,
			routeKey: campaign.routeKey,
			name: campaign.name,
			lifecycle: "active",
			capabilities,
		});
	}

	return { mode: "first_class", campaigns };
}
