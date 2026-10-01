import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentAccess } from "@/features/auth/server";
import { readEditableWorldCampaigns } from "@/features/campaigns/world";
import {
	WorldCampaignPage,
	requestedWorldFocus,
} from "@/features/world-explorer/world-page";
import {
	worldEditCampaignHref,
	type WorldCampaignSwitchOption,
} from "@/features/world-explorer/world-campaign";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Mundo · Edit",
	description: "Authoring do World Explorer no contexto explícito de uma campanha.",
};

type Props = {
	params: Promise<{ campaignSlug: string }>;
	searchParams: Promise<{ foco?: string | string[] }>;
};

export default async function EditCampaignWorldPage({ params, searchParams }: Props) {
	const [{ campaignSlug }, query, access] = await Promise.all([
		params,
		searchParams,
		currentAccess(),
	]);
	if (access.state === "anonymous") {
		redirect(
			`/entrar?next=${encodeURIComponent(worldEditCampaignHref(campaignSlug, requestedWorldFocus(query)))}`,
		);
	}
	if (access.state === "unavailable") redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId) redirect("/conta?acesso=negado");

	const eligible = await readEditableWorldCampaigns(access.context);
	if (!eligible.ok) throw new Error("WORLD_CAMPAIGN_DIRECTORY_UNAVAILABLE");
	const campaign = eligible.campaigns.find(
		(item) => item.technicalSlug === campaignSlug,
	);
	if (!campaign) notFound();

	const focus = requestedWorldFocus(query);
	const switchOptions: WorldCampaignSwitchOption[] = eligible.campaigns.map(
		(item) => ({
			key: item.technicalSlug,
			name: item.name,
			href: worldEditCampaignHref(item.technicalSlug, focus),
			current: item.technicalSlug === campaign.technicalSlug,
		}),
	);

	return (
		<WorldCampaignPage
			campaign={{
				technicalSlug: campaign.technicalSlug,
				routeKey: campaign.routeKey,
				name: campaign.name,
			}}
			searchParams={Promise.resolve(query)}
			switchOptions={switchOptions}
		/>
	);
}
