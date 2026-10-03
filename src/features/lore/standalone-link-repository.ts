import "server-only";

import { publishedDataClient } from "@/integrations/supabase/server";
import { loreRegistrationForSlug } from "./registry";

export type ResolvedStandaloneLoreCampaignLink = Readonly<{
	campaignId: string;
	technicalSlug: string;
	name: string;
	publicCampaign: Readonly<{ routeKey: string; name: string }> | null;
}>;

const E2E_LORE_CAMPAIGN_LINKS: Readonly<
	Record<string, ResolvedStandaloneLoreCampaignLink | null>
> = {
	astel: {
		campaignId: "fixture-a",
		technicalSlug: "yuhara-main",
		name: "Crônicas da Mesa",
		publicCampaign: {
			routeKey: "cronicas-da-mesa",
			name: "Crônicas da Mesa",
		},
	},
	noah: {
		campaignId: "fixture-a",
		technicalSlug: "yuhara-main",
		name: "Crônicas da Mesa",
		publicCampaign: {
			routeKey: "cronicas-da-mesa",
			name: "Crônicas da Mesa",
		},
	},
	pipipi: {
		campaignId: "fixture-b",
		technicalSlug: "antes-que-seja-tarde",
		name: "Antes que seja tarde — uma campanha com nome deliberadamente comprido",
		publicCampaign: {
			routeKey: "antes-que-seja-tarde",
			name: "Antes que seja tarde — uma campanha com nome deliberadamente comprido",
		},
	},
	seika: null,
};

function loreFixtureEnabled() {
	return process.env.TDA_E2E_FIXTURES === "true";
}

/**
 * Resolves an explicit editorial campaign binding only after the campaign exists.
 * Missing/legacy schema state fails closed to "unresolved"; no "unknown campaign"
 * DTO is invented for the public UI.
 */
export async function resolveStandaloneLoreCampaignLink(
	loreSlug: string,
): Promise<ResolvedStandaloneLoreCampaignLink | null> {
	if (
		loreFixtureEnabled() &&
		Object.prototype.hasOwnProperty.call(E2E_LORE_CAMPAIGN_LINKS, loreSlug)
	) {
		return E2E_LORE_CAMPAIGN_LINKS[loreSlug] ?? null;
	}

	const registration = loreRegistrationForSlug(loreSlug);
	const technicalSlug =
		registration?.campaignTechnicalSlug ??
		registration?.entityLink?.campaignTechnicalSlug;
	if (!technicalSlug) return null;

	const client = publishedDataClient();
	if (!client) return null;

	const identity = await client
		.from("campaigns")
		.select("id,slug,name")
		.eq("slug", technicalSlug)
		.maybeSingle();
	if (
		identity.error ||
		typeof identity.data?.id !== "string" ||
		typeof identity.data?.slug !== "string" ||
		typeof identity.data?.name !== "string"
	) {
		return null;
	}

	const publicState = await client
		.from("campaigns")
		.select("public_slug,lifecycle,visibility")
		.eq("id", identity.data.id)
		.maybeSingle();

	const routeKey =
		typeof publicState.data?.public_slug === "string"
			? publicState.data.public_slug
			: null;
	const isPublic =
		!publicState.error &&
		publicState.data?.lifecycle === "active" &&
		publicState.data?.visibility === "public" &&
		Boolean(routeKey);

	return {
		campaignId: identity.data.id,
		technicalSlug: identity.data.slug,
		name: identity.data.name,
		publicCampaign:
			isPublic && routeKey
				? { routeKey, name: identity.data.name }
				: null,
	};
}
