export const WORLD_ENTITY_MEDIA_PREVIEW_BUCKET = "tda-media-preview";
export const WORLD_ENTITY_MEDIA_PREVIEW_CORS_RULE_ID =
	"tda-world-entity-media-preview-upload";
export const WORLD_ENTITY_MEDIA_PENDING_LIFECYCLE_RULE_ID =
	"tda-world-entity-media-pending-expiry";
export const WORLD_ENTITY_MEDIA_PENDING_PREFIX = "uploads/pending/world-entity/";

export function normalizeWorldEntityMediaPreviewOrigin(rawOrigin) {
	if (typeof rawOrigin !== "string" || !rawOrigin.length) {
		throw new Error("WORLD_ENTITY_MEDIA_PREVIEW_ORIGIN_REQUIRED");
	}
	let parsed;
	try {
		parsed = new URL(rawOrigin);
	} catch {
		throw new Error("WORLD_ENTITY_MEDIA_PREVIEW_ORIGIN_INVALID");
	}
	if (
		parsed.protocol !== "https:" ||
		parsed.username ||
		parsed.password ||
		parsed.pathname !== "/" ||
		parsed.search ||
		parsed.hash ||
		!parsed.hostname.endsWith(".vercel.app")
	) {
		throw new Error("WORLD_ENTITY_MEDIA_PREVIEW_ORIGIN_INVALID");
	}
	return parsed.origin;
}

export function worldEntityMediaPreviewCorsRule(origin) {
	const normalizedOrigin = normalizeWorldEntityMediaPreviewOrigin(origin);
	return {
		ID: WORLD_ENTITY_MEDIA_PREVIEW_CORS_RULE_ID,
		AllowedOrigins: [normalizedOrigin],
		AllowedMethods: ["PUT"],
		AllowedHeaders: ["Content-Type"],
		ExposeHeaders: ["ETag"],
		MaxAgeSeconds: 600,
	};
}

export function worldEntityMediaPendingLifecycleRule() {
	return {
		ID: WORLD_ENTITY_MEDIA_PENDING_LIFECYCLE_RULE_ID,
		Status: "Enabled",
		Filter: { Prefix: WORLD_ENTITY_MEDIA_PENDING_PREFIX },
		Expiration: { Days: 1 },
	};
}

export function replaceManagedRule(rules, managedRule) {
	const existing = Array.isArray(rules) ? rules : [];
	return [...existing.filter((rule) => rule?.ID !== managedRule.ID), managedRule];
}

function stringArrayEqual(left, right) {
	return (
		Array.isArray(left) &&
		Array.isArray(right) &&
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

export function worldEntityMediaCorsRuleMatches(actual, expected) {
	return Boolean(
		actual &&
		actual.ID === expected.ID &&
		stringArrayEqual(actual.AllowedOrigins, expected.AllowedOrigins) &&
		stringArrayEqual(actual.AllowedMethods, expected.AllowedMethods) &&
		stringArrayEqual(actual.AllowedHeaders, expected.AllowedHeaders) &&
		stringArrayEqual(actual.ExposeHeaders, expected.ExposeHeaders) &&
		actual.MaxAgeSeconds === expected.MaxAgeSeconds,
	);
}

export function worldEntityMediaLifecycleRuleMatches(actual, expected) {
	return Boolean(
		actual &&
		actual.ID === expected.ID &&
		actual.Status === expected.Status &&
		actual.Filter?.Prefix === expected.Filter.Prefix &&
		actual.Expiration?.Days === expected.Expiration.Days,
	);
}
