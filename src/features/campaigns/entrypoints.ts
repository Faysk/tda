const MANAGEMENT_PATH = "/edit/campanhas";

export function campaignManagementHref(returnTo?: string | null): string {
	if (!returnTo) return MANAGEMENT_PATH;
	return `${MANAGEMENT_PATH}?next=${encodeURIComponent(returnTo)}`;
}

export function campaignCreationHref(returnTo?: string | null): string {
	return `${campaignManagementHref(returnTo)}#create-campaign`;
}
