import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
	return {
		title: profile.identity.name,
		description:
			profile.identity.summary ??
			`Memórias, relações e momentos de ${profile.identity.name}.`,
		alternates: { canonical: href },
	};
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
