export const WORLD_DEMO_CAMPAIGN_SLUG = "yuhara-main";

const TECHNICAL_SLUG = /^[A-Za-z0-9_-]{1,128}$/u;
const ROUTE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type WorldCampaignSwitchOption = Readonly<{
	key: string;
	name: string;
	href: string;
	current?: boolean;
}>;

export function isWorldCampaignSlug(value: unknown): value is string {
	return typeof value === "string" && TECHNICAL_SLUG.test(value);
}

export function isWorldCampaignRouteKey(value: unknown): value is string {
	return typeof value === "string" && ROUTE_KEY.test(value);
}

function focusQuery(focus?: string): string {
	return focus ? `?foco=${encodeURIComponent(focus)}` : "";
}

export function worldPublicCampaignHref(routeKey: string, focus?: string): string {
	if (!isWorldCampaignRouteKey(routeKey)) throw new Error("WORLD_CAMPAIGN_INVALID_ROUTE_KEY");
	return `/campanhas/${routeKey}/mundo${focusQuery(focus)}`;
}

export function worldEditCampaignHref(campaignSlug: string, focus?: string): string {
	if (!isWorldCampaignSlug(campaignSlug)) throw new Error("WORLD_CAMPAIGN_INVALID_SLUG");
	return `/edit/${campaignSlug}/mundo${focusQuery(focus)}`;
}

export function worldEditLeaseStorageKey(campaignSlug: string): string {
	if (!isWorldCampaignSlug(campaignSlug)) throw new Error("WORLD_CAMPAIGN_INVALID_SLUG");
	return `tda.world.edit.lease.${campaignSlug}`;
}
