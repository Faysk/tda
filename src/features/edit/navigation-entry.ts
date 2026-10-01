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

/**
 * Compatibility priority for the historical one-campaign entrypoint.
 * These links carry the campaign explicitly even though the legacy pages still
 * resolve the same historical scope until their dedicated multi-campaign slices land.
 */
export const EDIT_ENTRY_PRIORITY: readonly EditEntryDestination[] = [
	{
		href: campaignQuery(
			"/edit/sessoes",
			LEGACY_CAMPAIGN_TECHNICAL_SLUG,
		),
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
	if (campaignSlug === LEGACY_CAMPAIGN_TECHNICAL_SLUG)
		return EDIT_ENTRY_PRIORITY;

	return [
		{
			href: campaignQuery("/transcricoes", campaignSlug),
			capability: EDIT_CAPABILITIES.transcriptRead,
		},
		{
			href: `/edit/${encodeURIComponent(campaignSlug)}/permissions`,
			capability: EDIT_CAPABILITIES.permissionsManage,
		},
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
