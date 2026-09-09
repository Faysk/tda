import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildPublicMetadata } from "@/config/public-metadata";
import { LorePage } from "@/features/lore/components/lore-page";
import { findPublishedLoreProfile } from "@/features/lore/repository";

const PIPIPI_SLUG = "pipipi";

export async function generateMetadata(): Promise<Metadata> {
	const profile = await findPublishedLoreProfile("personagens", PIPIPI_SLUG);
	if (!profile) return { title: "Lore não encontrada" };

	return buildPublicMetadata({
		title: "Pipipi — A Casa Onde os Super-Heróis Visitavam",
		description:
			profile.identity.summary ??
			"A história de Pipipi, a Casa onde viveu e as duas metades de uma mesma memória.",
		pathname: "/lore/pipipi",
		type: "article",
	});
}

export default async function PipipiLoreRoute() {
	const profile = await findPublishedLoreProfile("personagens", PIPIPI_SLUG);
	if (!profile) notFound();
	return <LorePage profile={profile} />;
}
