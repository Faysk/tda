export const CAMPAIGN_LIFECYCLES = ["active", "archived"] as const;
export type CampaignLifecycle = (typeof CAMPAIGN_LIFECYCLES)[number];

export const CAMPAIGN_VISIBILITIES = ["public", "private"] as const;
export type CampaignVisibility = (typeof CAMPAIGN_VISIBILITIES)[number];

export type PublicCampaign = Readonly<{
	routeKey: string;
	name: string;
	description: string | null;
	coverImage: string | null;
}>;

export type ManageableCampaign = Readonly<{
	id: string;
	technicalSlug: string;
	routeKey: string;
	name: string;
	description: string | null;
	lifecycle: CampaignLifecycle;
	visibility: CampaignVisibility;
	archivedAt: string | null;
	updatedAt: string;
	coverImage: string | null;
}>;

export type CampaignMutationFailure =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "validation"
	| "conflict"
	| "not_found"
	| "dependency_unavailable";

export type CampaignMutationResult =
	| Readonly<{
		ok: true;
		campaign: ManageableCampaign;
	  }>
	| Readonly<{
		ok: false;
		reason: CampaignMutationFailure;
		field?: "name" | "technicalSlug" | "routeKey" | "description" | "visibility";
	  }>;

const ROUTE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function normalizeCampaignName(value: string): string | null {
	const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
	if (normalized.length < 2 || normalized.length > 120) return null;
	if (/\p{Cc}|\p{Cs}/u.test(normalized)) return null;
	return normalized;
}

export function normalizeCampaignDescription(value: string): string | null {
	const normalized = value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
	if (!normalized) return null;
	if (normalized.length > 600 || /\p{Cc}/u.test(normalized.replace(/\n/gu, "")))
		return null;
	return normalized;
}

export function normalizeCampaignRouteKey(value: string): string | null {
	const normalized = value.normalize("NFKC").trim();
	if (normalized.length < 2 || normalized.length > 80) return null;
	if (!ROUTE_KEY.test(normalized)) return null;
	return normalized;
}

export function isCampaignId(value: string): boolean {
	return UUID.test(value);
}

export function isCampaignLifecycle(value: unknown): value is CampaignLifecycle {
	return CAMPAIGN_LIFECYCLES.includes(value as CampaignLifecycle);
}

export function isCampaignVisibility(value: unknown): value is CampaignVisibility {
	return CAMPAIGN_VISIBILITIES.includes(value as CampaignVisibility);
}
