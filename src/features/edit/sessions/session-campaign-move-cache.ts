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
	const sessionKey = encodeURIComponent(input.sourceSessionId);
	return [
		"/",
		"/campanhas",
		"/campanhas/sessoes",
		"/sessoes",
		`/sessoes/${sessionKey}`,
		editSessionLibraryHref(input.sourceCampaignSlug),
		editSessionLibraryHref(input.destinationCampaignSlug),
		editSessionDetailHref(input.sourceCampaignSlug, input.sourceSessionId),
		editSessionDetailHref(
			input.destinationCampaignSlug,
			input.sourceSessionId,
		),
		sourcePublicRoot,
		destinationPublicRoot,
		`${sourcePublicRoot}/${sessionKey}`,
		`${destinationPublicRoot}/${sessionKey}`,
	];
}
