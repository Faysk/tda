import "server-only";

import {
	readAuthorizedCampaigns,
	type AuthorizedCampaign,
} from "@/features/campaigns/authorized";
import type { EditAccessContext } from "@/features/edit/access/policy";
import {
	ACCOUNT_CAPABILITIES,
	effectiveAccountCampaignCapabilityGroups,
	explicitAccountCampaignSlugsForCapability,
	type AccountCapabilityGroup,
} from "./account-access";

export type AccountCampaignAccess = Readonly<{
	technicalSlug: string;
	name: string;
	lifecycle: AuthorizedCampaign["lifecycle"];
	capabilityGroups: readonly AccountCapabilityGroup[];
}>;

export type AccountCampaignAccessResult =
	| Readonly<{
			status: "ready";
			campaigns: readonly AccountCampaignAccess[];
	  }>
	| Readonly<{
			status: "unavailable";
			campaigns: readonly [];
	  }>;

export async function readAccountCampaignAccess(
	context: EditAccessContext,
): Promise<AccountCampaignAccessResult> {
	if (!context.profileId) return { status: "ready", campaigns: [] };

	const requestedByCapability = ACCOUNT_CAPABILITIES.map((capability) => ({
		capability,
		slugs: explicitAccountCampaignSlugsForCapability(context, capability),
	})).filter((entry) => entry.slugs.length > 0);

	if (requestedByCapability.length === 0)
		return { status: "ready", campaigns: [] };

	const requestedSlugs = new Set(
		requestedByCapability.flatMap((entry) => entry.slugs),
	);
	const discovered = new Map<string, AuthorizedCampaign>();

	for (const { capability, slugs } of requestedByCapability) {
		const result = await readAuthorizedCampaigns(context, capability, {
			includeArchived: true,
		});
		if (!result.ok) return { status: "unavailable", campaigns: [] };

		const allowedForCapability = new Set(slugs);
		for (const campaign of result.campaigns) {
			if (
				requestedSlugs.has(campaign.technicalSlug) &&
				allowedForCapability.has(campaign.technicalSlug)
			)
				discovered.set(campaign.technicalSlug, campaign);
		}
	}

	if ([...requestedSlugs].some((slug) => !discovered.has(slug)))
		return { status: "unavailable", campaigns: [] };

	const campaigns = [...discovered.values()]
		.map((campaign) => ({
			technicalSlug: campaign.technicalSlug,
			name: campaign.name,
			lifecycle: campaign.lifecycle,
			capabilityGroups: effectiveAccountCampaignCapabilityGroups(
				context,
				campaign.technicalSlug,
			),
		}))
		.filter((campaign) => campaign.capabilityGroups.length > 0)
		.sort((left, right) =>
			left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }),
		);

	return { status: "ready", campaigns };
}
