import type { PublishedSession } from "./model";

export const HOME_RECENT_SESSION_LIMIT = 4;
export const HOME_SESSION_FEED_LIMIT = HOME_RECENT_SESSION_LIMIT + 1;

function compareText(a: string, b: string) {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function compareHomeSessions(
	a: PublishedSession,
	b: PublishedSession,
): number {
	const byDate = compareText(b.date, a.date);
	if (byDate !== 0) return byDate;

	const byCampaign = compareText(a.campaignSlug, b.campaignSlug);
	if (byCampaign !== 0) return byCampaign;

	return compareText(a.id, b.id);
}

export function buildHomeSessionFeed(
	sessions: readonly PublishedSession[],
	recentLimit = HOME_RECENT_SESSION_LIMIT,
) {
	const ordered = [...sessions].sort(compareHomeSessions);
	const latest = ordered[0];
	return {
		ordered,
		latest,
		recent: ordered.slice(latest ? 1 : 0, latest ? recentLimit + 1 : recentLimit),
	} as const;
}
