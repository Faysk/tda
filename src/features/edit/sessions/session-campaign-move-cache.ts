import {
	editSessionDetailHref,
	editSessionLibraryHref,
} from "@/features/campaigns/session-routes";

export type SessionCampaignMoveCacheInput = Readonly<{
	sourceCampaignSlug: string;
	sourceRouteKey: string;
	destinationCampaignSlug: string;
	destinationRouteKey: string;
	sourceSessionId: string;
}>;

export function sessionCampaignMoveRevalidationPaths(
	input: SessionCampaignMoveCacheInput,
): readonly string[] {
	const sourcePublicRoot =
		`/campanhas/${encodeURIComponent(input.sourceRouteKey)}/sessoes`;
	const destinationPublicRoot =
		`/campanhas/${encodeURIComponent(input.destinationRouteKey)}/sessoes`;
	const sourcePublicDetail =
		`${sourcePublicRoot}/${encodeURIComponent(input.sourceSessionId)}`;
	const destinationPublicDetail =
		`${destinationPublicRoot}/${encodeURIComponent(input.sourceSessionId)}`;
	return Array.from(new Set([
		"/",
		"/campanhas",
		"/campanhas/sessoes",
		editSessionLibraryHref(input.sourceCampaignSlug),
		editSessionLibraryHref(input.destinationCampaignSlug),
		editSessionDetailHref(input.sourceCampaignSlug, input.sourceSessionId),
		editSessionDetailHref(input.destinationCampaignSlug, input.sourceSessionId),
		"/sessoes",
		`/sessoes/${encodeURIComponent(input.sourceSessionId)}`,
		sourcePublicRoot,
		destinationPublicRoot,
		sourcePublicDetail,
		destinationPublicDetail,
	]));
}
