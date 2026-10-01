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
	return buildCampaignLoreProfileMetadata("faccoes", campaignSlug, slug);
}

export default async function FactionsCampaignLorePage({ params }: Params) {
	const { campaignSlug, slug } = await params;
	return renderCampaignLoreProfilePage("faccoes", campaignSlug, slug);
}
