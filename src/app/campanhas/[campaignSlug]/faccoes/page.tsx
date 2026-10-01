import type { Metadata } from "next";
import {
	buildCampaignLoreIndexMetadata,
	renderCampaignLoreIndexPage,
} from "@/features/lore/campaign-route";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ campaignSlug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
	const { campaignSlug } = await params;
	return buildCampaignLoreIndexMetadata("faccoes", campaignSlug);
}

export default async function FactionsCampaignIndexPage({ params }: Params) {
	const { campaignSlug } = await params;
	return renderCampaignLoreIndexPage("faccoes", campaignSlug);
}
