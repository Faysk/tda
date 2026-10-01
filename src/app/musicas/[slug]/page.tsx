import type { Metadata } from "next";
import {
	buildLegacyLoreProfileMetadata,
	renderLegacyLoreProfilePage,
} from "@/features/lore/campaign-route";

type LoreParams = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: LoreParams): Promise<Metadata> {
	const { slug } = await params;
	return buildLegacyLoreProfileMetadata("musicas", slug);
}

export default async function MusicLorePage({ params }: LoreParams) {
	const { slug } = await params;
	return renderLegacyLoreProfilePage("musicas", slug);
}
