import "server-only";

import { readCampaignRegistry } from "@/features/campaigns/repository";
import {
	isEffectiveCampaignGrant,
	type EditAccessContext,
} from "@/features/edit/access/policy";
import {
	effectiveAccountCapabilityGroups,
	type AccountCapabilityGroup,
} from "./account-access";

export type AccountCampaignScope = "campaign" | "project" | "mixed";

export type AccountCampaignAccess = Readonly<{
	technicalSlug: string;
	routeKey: string;
	name: string;
	scope: AccountCampaignScope;
	groups: readonly AccountCapabilityGroup[];
}>;

export type AccountCampaignAccessResult =
	| Readonly<{ ok: true; campaigns: readonly AccountCampaignAccess[] }>
	| Readonly<{ ok: false; reason: "dependency_unavailable" }>;

function effectiveScope(
	context: EditAccessContext,
	campaignSlug: string,
	capabilities: ReadonlySet<string>,
	now: Date,
): AccountCampaignScope {
	let project = false;
	let campaign = false;
	for (const grant of context.grants) {
		if (!capabilities.has(grant.action)) continue;
		if (!isEffectiveCampaignGrant(grant, campaignSlug, now)) continue;
		if (grant.scopeType === "project") project = true;
		if (grant.scopeType === "campaign") campaign = true;
	}
	return project && campaign ? "mixed" : project ? "project" : "campaign";
}

export async function readAccountCampaignAccess(
	context: EditAccessContext,
	now = new Date(),
): Promise<AccountCampaignAccessResult> {
	if (!context.profileId) return { ok: true, campaigns: [] };
	const registry = await readCampaignRegistry();
	if (!registry) return { ok: false, reason: "dependency_unavailable" };

	const campaigns = registry
		.filter((campaign) => campaign.lifecycle === "active")
		.flatMap((campaign) => {
			const groups = effectiveAccountCapabilityGroups(
				context,
				campaign.technicalSlug,
				now,
			);
			if (!groups.length) return [];
			const capabilities = new Set(
				groups.flatMap((group) => group.items.map((item) => item.capability)),
			);
			return [{
				technicalSlug: campaign.technicalSlug,
				routeKey: campaign.routeKey,
				name: campaign.name,
				scope: effectiveScope(context, campaign.technicalSlug, capabilities, now),
				groups,
			} satisfies AccountCampaignAccess];
		})
		.sort((left, right) =>
			left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }),
		);

	return { ok: true, campaigns };
}
