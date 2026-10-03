import "server-only";

import { readAuthorizedCampaignAccess } from "@/features/campaigns/authorized";
import type { EditAccessContext } from "@/features/edit/access/policy";
import {
	ACCOUNT_CAPABILITIES,
	effectiveAccountCapabilityGroups,
	type AccountEffectiveCapabilityGroup,
} from "./account-access";

export type AccountCampaignOption = Readonly<{
	technicalSlug: string;
	name: string;
}>;

export type AccountCampaignSelection = AccountCampaignOption &
	Readonly<{
		capabilityGroups: readonly AccountEffectiveCapabilityGroup[];
		projectCapabilityCount: number;
		campaignCapabilityCount: number;
	}>;

export type AccountCampaignAccess =
	| Readonly<{
		state: "ready";
		campaigns: readonly AccountCampaignOption[];
		selectedCampaign: AccountCampaignSelection | null;
		requestedCampaignUnavailable: boolean;
	  }>
	| Readonly<{
		state: "unavailable";
		campaigns: readonly [];
		selectedCampaign: null;
		requestedCampaignUnavailable: false;
	  }>;

export const EMPTY_ACCOUNT_CAMPAIGN_ACCESS: AccountCampaignAccess = {
	state: "ready",
	campaigns: [],
	selectedCampaign: null,
	requestedCampaignUnavailable: false,
};

export async function readAccountCampaignAccess(
	context: EditAccessContext,
	requestedCampaignSlug: string | null,
): Promise<AccountCampaignAccess> {
	if (!context.profileId) return EMPTY_ACCOUNT_CAMPAIGN_ACCESS;

	const discovery = await readAuthorizedCampaignAccess(
		context,
		ACCOUNT_CAPABILITIES,
	);
	if (!discovery.ok) {
		return {
			state: "unavailable",
			campaigns: [],
			selectedCampaign: null,
			requestedCampaignUnavailable: false,
		};
	}

	const campaigns = discovery.campaigns
		.map((campaign) => ({
			technicalSlug: campaign.technicalSlug,
			name: campaign.name,
		}))
		.sort((left, right) =>
			left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }),
		);
	const requested =
		requestedCampaignSlug === null
			? null
			: campaigns.find(
					(campaign) => campaign.technicalSlug === requestedCampaignSlug,
				) ?? null;
	const selected =
		requested ?? (requestedCampaignSlug === null && campaigns.length === 1 ? campaigns[0] : null);
	if (!selected) {
		return {
			state: "ready",
			campaigns,
			selectedCampaign: null,
			requestedCampaignUnavailable:
				requestedCampaignSlug !== null && requested === null,
		};
	}

	const capabilityGroups = effectiveAccountCapabilityGroups(
		context,
		selected.technicalSlug,
	);
	const capabilities = capabilityGroups.flatMap((group) => group.items);
	return {
		state: "ready",
		campaigns,
		selectedCampaign: {
			...selected,
			capabilityGroups,
			projectCapabilityCount: capabilities.filter(
				(item) => item.scope === "project",
			).length,
			campaignCapabilityCount: capabilities.filter(
				(item) => item.scope === "campaign",
			).length,
		},
		requestedCampaignUnavailable: false,
	};
}
