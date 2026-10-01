/**
 * Stable campaign-owned media identity.
 *
 * `campaignMediaKey` is the immutable technical campaign slug from
 * `campaigns.slug`. It is deliberately NOT the public route key
 * (`campaigns.public_slug`) or the human-readable campaign name.
 *
 * Keeping that distinction here means a public rename never moves R2 bytes.
 */
export const LEGACY_CAMPAIGN_MEDIA_KEY = "yuhara-main";
export const CAMPAIGN_MEDIA_PUBLIC_ORIGIN = "https://media.dnd.faysk.dev";

const CAMPAIGN_MEDIA_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,95}$/u;

export function isCampaignMediaKey(value: unknown): value is string {
	return typeof value === "string" && CAMPAIGN_MEDIA_KEY_PATTERN.test(value);
}

export function campaignMediaPrefix(campaignMediaKey: string): string | null {
	return isCampaignMediaKey(campaignMediaKey)
		? `campaigns/${campaignMediaKey}/`
		: null;
}

export function campaignMediaObjectBelongsTo(input: {
	objectKey: string;
	campaignMediaKey: string;
	resourcePrefix?: string;
}): boolean {
	const prefix = campaignMediaPrefix(input.campaignMediaKey);
	if (!prefix || !input.objectKey || input.objectKey.startsWith("/")) return false;
	const scopedPrefix = input.resourcePrefix
		? prefix + input.resourcePrefix.replace(/^\/+|\/+$/gu, "") + "/"
		: prefix;
	return input.objectKey.startsWith(scopedPrefix);
}

export function campaignMediaPublicUrl(input: {
	value: unknown;
	campaignMediaKey: string;
	resourcePrefix?: string;
}): string | null {
	if (typeof input.value !== "string" || input.value.length > 2048) return null;
	try {
		const url = new URL(input.value);
		if (
			url.protocol !== "https:" ||
			url.hostname !== "media.dnd.faysk.dev" ||
			url.port ||
			url.search ||
			url.hash ||
			url.username ||
			url.password
		) {
			return null;
		}
		const objectKey = url.pathname.replace(/^\/+/, "");
		return campaignMediaObjectBelongsTo({
			objectKey,
			campaignMediaKey: input.campaignMediaKey,
			resourcePrefix: input.resourcePrefix,
		})
			? url.toString()
			: null;
	} catch {
		return null;
	}
}

/**
 * Cache/idempotency identity for campaign-owned media references.
 *
 * Includes both relational owner and immutable storage namespace so equal
 * source/resource ids in sibling campaigns cannot share a cache entry.
 */
export function campaignMediaCacheKey(input: {
	campaignId: string;
	campaignMediaKey: string;
	resourceKind: string;
	resourceId: string;
	role: string;
}): string | null {
	if (
		!input.campaignId ||
		!isCampaignMediaKey(input.campaignMediaKey) ||
		!input.resourceKind ||
		!input.resourceId ||
		!input.role
	) {
		return null;
	}
	return [
		"campaign-media",
		encodeURIComponent(input.campaignId),
		encodeURIComponent(input.campaignMediaKey),
		encodeURIComponent(input.resourceKind),
		encodeURIComponent(input.resourceId),
		encodeURIComponent(input.role),
	].join(":");
}
