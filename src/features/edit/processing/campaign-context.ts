export type ProcessingCampaignOption = Readonly<{
	technicalSlug: string;
	name: string;
	routeKey: string;
}>;

const SAFE_CAMPAIGN_SLUG = /^[A-Za-z0-9_-]{1,128}$/u;

export function processingCampaignHref(campaignSlug: string): string {
	if (!SAFE_CAMPAIGN_SLUG.test(campaignSlug))
		throw new Error("Invalid processing campaign slug");
	return `/edit/${encodeURIComponent(campaignSlug)}/processamento`;
}
