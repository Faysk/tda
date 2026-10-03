import { notFound } from "next/navigation";
import { LembraCampaignFixtureClient } from "./fixture-client";

export const dynamic = "force-dynamic";

type Props = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LembraCampaignE2EFixture({ searchParams }: Props) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const params = await searchParams;
	return (
		<LembraCampaignFixtureClient
			canManageCampaigns={params.manage !== "0"}
			canDiscoverPrivateCampaigns={params.private !== "0"}
		/>
	);
}
