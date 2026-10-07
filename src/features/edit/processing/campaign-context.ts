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

export function resolveProcessingCampaign(
	campaigns: readonly ProcessingCampaignOption[],
	reference: string,
): ProcessingCampaignOption | null {
	return (
		campaigns.find((campaign) => campaign.routeKey === reference) ??
		campaigns.find((campaign) => campaign.technicalSlug === reference) ??
		null
	);
}

export function processingCampaignNavigationHref(
	campaigns: readonly ProcessingCampaignOption[],
	technicalSlug: string,
): string {
	const campaign = campaigns.find(
		(option) => option.technicalSlug === technicalSlug,
	);
	if (!campaign) throw new Error("Unavailable processing campaign");
	return processingCampaignHref(campaign.routeKey);
}
