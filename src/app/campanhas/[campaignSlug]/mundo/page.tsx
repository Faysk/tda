import { notFound, permanentRedirect } from "next/navigation";
import {
	readPublicCampaignDirectory,
	resolvePublicCampaignRoute,
} from "@/features/campaigns/server";
import {
	type WorldCampaignContext,
	WorldCampaignPage,
	buildWorldCampaignMetadata,
	requestedWorldFocus,
} from "@/features/world-explorer/world-page";
import {
	worldPublicCampaignHref,
	type WorldCampaignSwitchOption,
} from "@/features/world-explorer/world-campaign";

export const dynamic = "force-dynamic";

type Props = {
	params: Promise<{ campaignSlug: string }>;
	searchParams: Promise<{ foco?: string | string[] }>;
};

async function resolveCampaign(routeKey: string): Promise<WorldCampaignContext> {
	const resolved = await resolvePublicCampaignRoute(routeKey);
	if (!resolved.ok) {
		if (resolved.reason === "not_found") notFound();
		throw new Error("WORLD_CAMPAIGN_DIRECTORY_UNAVAILABLE");
	}
	return {
		technicalSlug: resolved.campaign.technicalSlug,
		routeKey: resolved.campaign.routeKey,
		name: resolved.campaign.name,
	};
}

export async function generateMetadata({ params, searchParams }: Props) {
	const { campaignSlug } = await params;
	const campaign = await resolveCampaign(campaignSlug);
	return buildWorldCampaignMetadata({ campaign, searchParams });
}

export default async function CampaignWorldPage({ params, searchParams }: Props) {
	const [{ campaignSlug }, query] = await Promise.all([params, searchParams]);
	const resolved = await resolvePublicCampaignRoute(campaignSlug);
	if (!resolved.ok) {
		if (resolved.reason === "not_found") notFound();
		throw new Error("WORLD_CAMPAIGN_DIRECTORY_UNAVAILABLE");
	}
	const focus = requestedWorldFocus(query);
	if (!resolved.canonical) {
		permanentRedirect(worldPublicCampaignHref(resolved.campaign.routeKey, focus));
	}

	const directory = await readPublicCampaignDirectory();
	const switchOptions: WorldCampaignSwitchOption[] = directory.ok
		? directory.campaigns.map((campaign) => ({
				key: campaign.routeKey,
				name: campaign.name,
				href: worldPublicCampaignHref(campaign.routeKey, focus),
			}))
		: [];

	return (
		<WorldCampaignPage
			campaign={{
				technicalSlug: resolved.campaign.technicalSlug,
				routeKey: resolved.campaign.routeKey,
				name: resolved.campaign.name,
			}}
			searchParams={Promise.resolve(query)}
			switchOptions={switchOptions}
		/>
	);
}
