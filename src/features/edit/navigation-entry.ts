import { canManageCampaignRegistry } from "@/features/campaigns/policy";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
	type EditCapability,
} from "@/features/edit/access/policy";
import { LEGACY_CAMPAIGN_TECHNICAL_SLUG } from "@/features/sessions/model";

export type EditEntryDestination = Readonly<{
	href: string;
	capability: EditCapability;
}>;

function campaignQuery(href: string, campaignSlug: string): string {
	return `${href}?campanha=${encodeURIComponent(campaignSlug)}`;
}

function campaignEditSessionsHref(campaignSlug: string): string {
	return `/edit/${encodeURIComponent(campaignSlug)}/sessoes`;
}

/**
 * Compatibility priority for the historical /edit entrypoint.
 * Canonical campaign-aware destinations are preferred whenever the owning slice
 * already exists; only still-global tools keep an explicit compatibility query.
 */
export const EDIT_ENTRY_PRIORITY: readonly EditEntryDestination[] = [
	{
		href: campaignEditSessionsHref(LEGACY_CAMPAIGN_TECHNICAL_SLUG),
		capability: EDIT_CAPABILITIES.transcriptRead,
	},
	{
		href: campaignQuery(
			"/edit/processamento",
			LEGACY_CAMPAIGN_TECHNICAL_SLUG,
		),
		capability: EDIT_CAPABILITIES.localProcess,
	},
	{
		href: campaignQuery("/mundo", LEGACY_CAMPAIGN_TECHNICAL_SLUG),
		capability: EDIT_CAPABILITIES.worldLayoutEdit,
	},
	{
		href: campaignQuery(
			"/edit/revisao",
			LEGACY_CAMPAIGN_TECHNICAL_SLUG,
		),
		capability: EDIT_CAPABILITIES.reviewRead,
	},
	{
		href: `/edit/${LEGACY_CAMPAIGN_TECHNICAL_SLUG}/permissions`,
		capability: EDIT_CAPABILITIES.permissionsManage,
	},
];

function destinationsForCampaign(
	campaignSlug: string,
): readonly EditEntryDestination[] {
	const shared: EditEntryDestination[] = [
		{
			href: campaignEditSessionsHref(campaignSlug),
			capability: EDIT_CAPABILITIES.transcriptRead,
		},
		{
			href: campaignQuery("/edit/processamento", campaignSlug),
			capability: EDIT_CAPABILITIES.localProcess,
		},
		{
			href: `/edit/${encodeURIComponent(campaignSlug)}/permissions`,
			capability: EDIT_CAPABILITIES.permissionsManage,
		},
	];
	if (campaignSlug !== LEGACY_CAMPAIGN_TECHNICAL_SLUG) return shared;

	return [
		shared[0]!,
		shared[1]!,
		{
			href: campaignQuery("/mundo", campaignSlug),
			capability: EDIT_CAPABILITIES.worldLayoutEdit,
		},
		{
			href: campaignQuery("/edit/revisao", campaignSlug),
			capability: EDIT_CAPABILITIES.reviewRead,
		},
		shared[2]!,
	];
}

export function firstAuthorizedEditDestination(
	context: EditAccessContext,
	campaignSlug = LEGACY_CAMPAIGN_TECHNICAL_SLUG,
	now = new Date(),
): string | null {
	if (canManageCampaignRegistry(context, now)) return "/edit/campanhas";

	for (const destination of destinationsForCampaign(campaignSlug)) {
		if (
			authorizeCampaignCapability(
				context,
				destination.capability,
				campaignSlug,
				now,
			).ok
		) {
			return destination.href;
		}
	}
	return null;
}
