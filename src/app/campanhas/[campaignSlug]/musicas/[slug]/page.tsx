import type { Metadata } from "next";
import {
	buildCampaignLoreProfileMetadata,
	renderCampaignLoreProfilePage,
} from "@/features/lore/campaign-route";

export const dynamic = "force-dynamic";

type Params = {
	params: Promise<{ campaignSlug: string; slug: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
	const { campaignSlug, slug } = await params;
	return buildCampaignLoreProfileMetadata("musicas", campaignSlug, slug);
}

export default async function MusicCampaignLorePage({ params }: Params) {
	const { campaignSlug, slug } = await params;
	return renderCampaignLoreProfilePage("musicas", campaignSlug, slug);
}
