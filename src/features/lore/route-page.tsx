import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildPublicMetadata } from "@/config/public-metadata";
import { LorePage } from "./components/lore-page";
import type {
	LoreCampaignContext,
	LoreRouteKind,
} from "./model";
import { findPublishedLoreProfile } from "./repository";
import {
	loreHrefFor,
	routeAcceptsLoreEntity,
} from "./routes";

export async function buildLoreMetadata(
	routeKind: LoreRouteKind,
	slug: string,
	campaign: LoreCampaignContext,
): Promise<Metadata> {
	const profile = await findPublishedLoreProfile(routeKind, slug, campaign);
	if (!profile || !routeAcceptsLoreEntity(routeKind, profile.identity.entityType)) {
		return { title: "Lore não encontrada" };
	}

	const href = loreHrefFor(
		profile.identity.entityType,
		profile.identity.slug,
		campaign.routeKey,
	);
	if (!href) return { title: "Lore não encontrada" };
	return buildPublicMetadata({
		title: profile.identity.name,
		description:
			profile.identity.summary ??
			`Conheça ${profile.identity.name} no arquivo de histórias e memórias de ${campaign.name}.`,
		pathname: href,
		type: "article",
	});
}

export async function renderLoreRoutePage(
	routeKind: LoreRouteKind,
	slug: string,
	campaign: LoreCampaignContext,
) {
	const profile = await findPublishedLoreProfile(routeKind, slug, campaign);
	if (!profile || !routeAcceptsLoreEntity(routeKind, profile.identity.entityType)) {
		notFound();
	}

	return <LorePage profile={profile} />;
}
