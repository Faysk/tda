import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LoreIndexPage } from "./components/lore-index-page";
import {
	LEGACY_LORE_CAMPAIGN_CONTEXT,
	resolveLoreCampaignContext,
} from "./campaign-context";
import { loreIndexMetadata } from "./index-config";
import type { LoreRouteKind } from "./model";
import { buildLoreMetadata, renderLoreRoutePage } from "./route-page";
import {
	loreHrefFor,
	loreIndexHref,
	primaryLoreEntityTypeForRoute,
} from "./routes";

function CampaignLoreUnavailable({ label }: { label: string }) {
	return (
		<main data-layout-family="editorial" data-layout-role="editorial">
			<p role="status">Não foi possível carregar {label} desta campanha agora.</p>
		</main>
	);
}

export async function buildCampaignLoreIndexMetadata(
	routeKind: LoreRouteKind, campaignRouteKey: string,
): Promise<Metadata> {
	const resolved = await resolveLoreCampaignContext(campaignRouteKey);
	return resolved.ok
		? loreIndexMetadata(routeKind, resolved.campaign)
		: loreIndexMetadata(routeKind);
}

export async function renderCampaignLoreIndexPage(
	routeKind: LoreRouteKind, campaignRouteKey: string,
) {
	const resolved = await resolveLoreCampaignContext(campaignRouteKey);
	if (resolved.ok === false) {
		if (resolved.reason === "not_found") notFound();
		return <CampaignLoreUnavailable label="este arquivo" />;
	}
	if (!resolved.canonical) {
		redirect(loreIndexHref(routeKind, resolved.campaign.routeKey));
	}
	return <LoreIndexPage routeKind={routeKind} campaign={resolved.campaign} />;
}

export async function buildCampaignLoreProfileMetadata(
	routeKind: LoreRouteKind, campaignRouteKey: string, slug: string,
): Promise<Metadata> {
	const resolved = await resolveLoreCampaignContext(campaignRouteKey);
	if (resolved.ok === false) {
		return resolved.reason === "not_found"
			? { title: "Lore não encontrada" }
			: { title: "Lore temporariamente indisponível" };
	}
	return buildLoreMetadata(routeKind, slug, resolved.campaign);
}

export async function renderCampaignLoreProfilePage(
	routeKind: LoreRouteKind, campaignRouteKey: string, slug: string,
) {
	const resolved = await resolveLoreCampaignContext(campaignRouteKey);
	if (resolved.ok === false) {
		if (resolved.reason === "not_found") notFound();
		return <CampaignLoreUnavailable label="este perfil" />;
	}
	if (!resolved.canonical) {
		const href = loreHrefFor(
			primaryLoreEntityTypeForRoute(routeKind),
			slug,
			resolved.campaign.routeKey,
		);
		if (!href) notFound();
		redirect(href);
	}
	return renderLoreRoutePage(routeKind, slug, resolved.campaign);
}

export async function LegacyLoreIndexPage({ routeKind }: { routeKind: LoreRouteKind }) {
	return renderCampaignLoreIndexPage(routeKind, LEGACY_LORE_CAMPAIGN_CONTEXT.routeKey);
}

export async function buildLegacyLoreProfileMetadata(
	routeKind: LoreRouteKind, slug: string,
) {
	return buildCampaignLoreProfileMetadata(
		routeKind, LEGACY_LORE_CAMPAIGN_CONTEXT.routeKey, slug,
	);
}

export async function renderLegacyLoreProfilePage(
	routeKind: LoreRouteKind, slug: string,
) {
	return renderCampaignLoreProfilePage(
		routeKind, LEGACY_LORE_CAMPAIGN_CONTEXT.routeKey, slug,
	);
}
