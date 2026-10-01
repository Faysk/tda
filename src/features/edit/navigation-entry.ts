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

function campaignEditHref(
	campaignSlug: string,
	tool: "sessoes" | "processamento" | "mundo" | "revisao" | "permissions",
): string {
	return `/edit/${encodeURIComponent(campaignSlug)}/${tool}`;
}

function destinationsForCampaign(
	campaignSlug: string,
): readonly EditEntryDestination[] {
	return [
		{
			href: campaignEditHref(campaignSlug, "sessoes"),
			capability: EDIT_CAPABILITIES.transcriptRead,
		},
		{
			href: campaignEditHref(campaignSlug, "processamento"),
			capability: EDIT_CAPABILITIES.localProcess,
		},
		{
			href: campaignEditHref(campaignSlug, "mundo"),
			capability: EDIT_CAPABILITIES.worldLayoutEdit,
		},
		{
			href: campaignEditHref(campaignSlug, "revisao"),
			capability: EDIT_CAPABILITIES.reviewRead,
		},
		{
			href: campaignEditHref(campaignSlug, "permissions"),
			capability: EDIT_CAPABILITIES.permissionsManage,
		},
	];
}

export const EDIT_ENTRY_PRIORITY: readonly EditEntryDestination[] =
	destinationsForCampaign(LEGACY_CAMPAIGN_TECHNICAL_SLUG);

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
