import type { PublicCampaign } from "./model";
import { compareHomeSessions } from "@/features/sessions/home-feed";
import type { PublishedSession } from "@/features/sessions/model";

export type CampaignArtworkSource =
	| "campaign-cover"
	| "latest-session-cover"
	| "latest-session-hero"
	| "fallback";

export type CampaignDirectoryCard = PublicCampaign &
	Readonly<{
		artwork: string | null;
		artworkSource: CampaignArtworkSource;
		publishedSessionCount: number | null;
		latestSession: Readonly<{
			id: string;
			title: string;
			date: string;
		}> | null;
	}>;

export function buildCampaignDirectoryCards(
	campaigns: readonly PublicCampaign[],
	sessions: readonly PublishedSession[] | null,
): readonly CampaignDirectoryCard[] {
	const knownRoutes = new Set(campaigns.map((campaign) => campaign.routeKey));
	const byCampaign = new Map<string, PublishedSession[]>();

	if (sessions) {
		for (const session of sessions) {
			if (!knownRoutes.has(session.campaignSlug)) continue;
			const group = byCampaign.get(session.campaignSlug);
			if (group) group.push(session);
			else byCampaign.set(session.campaignSlug, [session]);
		}
		for (const group of byCampaign.values()) group.sort(compareHomeSessions);
	}

	return campaigns.map((campaign) => {
		const campaignSessions = sessions
			? (byCampaign.get(campaign.routeKey) ?? [])
			: null;
		const latest = campaignSessions?.[0] ?? null;

		const artwork = campaign.coverImage || latest?.coverImage || latest?.heroImage || null;
		const artworkSource: CampaignArtworkSource = campaign.coverImage
			? "campaign-cover"
			: latest?.coverImage
				? "latest-session-cover"
				: latest?.heroImage
					? "latest-session-hero"
					: "fallback";

		return {
			...campaign,
			artwork,
			artworkSource,
			publishedSessionCount: campaignSessions?.length ?? null,
			latestSession: latest
				? { id: latest.id, title: latest.title, date: latest.date }
				: null,
		};
	});
}
