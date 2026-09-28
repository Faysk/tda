import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
	type EditCapability,
} from "@/features/edit/access/policy";

type EditEntrypoint = Readonly<{
	capability: EditCapability;
	href: (campaignSlug: string) => string;
}>;

/**
 * Compatibility order for the legacy /edit entrypoint.
 *
 * Keep this explicit: /edit is no longer a menu, so a user with several
 * capabilities must always land on the same real tool.
 */
export const EDIT_ENTRYPOINTS: readonly EditEntrypoint[] = [
	{
		capability: EDIT_CAPABILITIES.transcriptRead,
		href: () => "/edit/sessoes",
	},
	{
		capability: EDIT_CAPABILITIES.localProcess,
		href: () => "/edit/processamento",
	},
	{
		capability: EDIT_CAPABILITIES.worldLayoutEdit,
		href: () => "/edit/mundo",
	},
	{
		capability: EDIT_CAPABILITIES.reviewRead,
		href: () => "/edit/revisao",
	},
	{
		capability: EDIT_CAPABILITIES.permissionsManage,
		href: (campaignSlug) => `/edit/${campaignSlug}/permissions`,
	},
] as const;

export function resolveEditEntrypoint(
	context: EditAccessContext,
	campaignSlug: string,
): string | null {
	for (const entrypoint of EDIT_ENTRYPOINTS) {
		if (
			authorizeCampaignCapability(
				context,
				entrypoint.capability,
				campaignSlug,
			).ok
		) {
			return entrypoint.href(campaignSlug);
		}
	}

	return null;
}
