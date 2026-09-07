import type { Metadata } from "next";
import {
	buildLoreMetadata,
	renderLoreRoutePage,
} from "@/features/lore/route-page";

type LoreParams = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: LoreParams): Promise<Metadata> {
	const { slug } = await params;
	return buildLoreMetadata("npcs", slug);
}

export default async function NpcLorePage({ params }: LoreParams) {
	const { slug } = await params;
	return renderLoreRoutePage("npcs", slug);
}
