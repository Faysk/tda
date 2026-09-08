import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildPublicMetadata } from "@/config/public-metadata";
import { LorePage } from "./components/lore-page";
import type { LoreRouteKind } from "./model";
import { findPublishedLoreProfile } from "./repository";
import { routeAcceptsLoreEntity } from "./routes";

export async function buildLoreMetadata(
	routeKind: LoreRouteKind,
	slug: string,
): Promise<Metadata> {
	const profile = await findPublishedLoreProfile(routeKind, slug);
	if (!profile || !routeAcceptsLoreEntity(routeKind, profile.identity.entityType)) {
		return { title: "Lore não encontrada" };
	}

	const href = `/${routeKind}/${encodeURIComponent(slug)}`;
	return buildPublicMetadata({
		title: profile.identity.name,
		description:
			profile.identity.summary ??
			`Conheça ${profile.identity.name} no arquivo de histórias e memórias da campanha.`,
		pathname: href,
		type: "article",
	});
}

export async function renderLoreRoutePage(
	routeKind: LoreRouteKind,
	slug: string,
) {
	const profile = await findPublishedLoreProfile(routeKind, slug);
	if (!profile || !routeAcceptsLoreEntity(routeKind, profile.identity.entityType)) {
		notFound();
	}

	return <LorePage profile={profile} />;
}
