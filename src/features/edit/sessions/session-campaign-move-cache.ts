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
	return [
		editSessionLibraryHref(input.sourceCampaignSlug),
		editSessionLibraryHref(input.destinationCampaignSlug),
		editSessionDetailHref(input.sourceCampaignSlug, input.sourceSessionId),
		editSessionDetailHref(input.destinationCampaignSlug, input.sourceSessionId),
		"/sessoes",
		`/campanhas/${encodeURIComponent(input.sourceRouteKey)}/sessoes`,
		`/campanhas/${encodeURIComponent(input.destinationRouteKey)}/sessoes`,
	];
}
