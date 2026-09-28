import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
	type EditCapability,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";

export type EditEntryDestination = Readonly<{
	href: string;
	capability: EditCapability;
}>;

/**
 * Compatibility contract for the historical /edit entrypoint.
 * Keep this order explicit: it is product/navigation policy, not object iteration.
 */
export const EDIT_ENTRY_PRIORITY: readonly EditEntryDestination[] = [
	{ href: "/edit/sessoes", capability: EDIT_CAPABILITIES.transcriptRead },
	{ href: "/edit/processamento", capability: EDIT_CAPABILITIES.localProcess },
	{ href: "/edit/mundo", capability: EDIT_CAPABILITIES.worldLayoutEdit },
	{ href: "/edit/revisao", capability: EDIT_CAPABILITIES.reviewRead },
	{
		href: `/edit/${CAMPAIGN_SLUG}/permissions`,
		capability: EDIT_CAPABILITIES.permissionsManage,
	},
];

export function firstAuthorizedEditDestination(
	context: EditAccessContext,
	now = new Date(),
): string | null {
	for (const destination of EDIT_ENTRY_PRIORITY) {
		if (
			authorizeCampaignCapability(
				context,
				destination.capability,
				CAMPAIGN_SLUG,
				now,
			).ok
		) {
			return destination.href;
		}
	}
	return null;
}
