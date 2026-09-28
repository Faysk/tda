import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
	type EditCapability,
} from "./policy";

type EditEntrypoint = Readonly<{
	href: string;
	capability: EditCapability;
}>;

export const EDIT_ENTRYPOINTS: readonly EditEntrypoint[] = [
	{ href: "/edit/sessoes", capability: EDIT_CAPABILITIES.transcriptRead },
	{ href: "/edit/processamento", capability: EDIT_CAPABILITIES.localProcess },
	{ href: "/edit/mundo", capability: EDIT_CAPABILITIES.worldLayoutEdit },
	{ href: "/edit/revisao", capability: EDIT_CAPABILITIES.reviewRead },
	{
		href: "/edit/:campaign/permissions",
		capability: EDIT_CAPABILITIES.permissionsManage,
	},
] as const;

export function selectEditEntrypoint(
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
			return entrypoint.href.replace(":campaign", campaignSlug);
		}
	}
	return null;
}
