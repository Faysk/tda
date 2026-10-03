import { notFound } from "next/navigation";
import type { LembraCampaignClassification, LembraReference } from "@/features/lembra/model";
import { LembraCampaignFixtureClient } from "./fixture-client";

export const dynamic = "force-dynamic";

const PRIVATE_CAMPAIGN: LembraCampaignClassification = {
	id: "66666666-6666-4666-8666-666666666666",
	name: "Passos Retomados",
	lifecycle: "active",
};

const PRIVATE_REFERENCE: LembraReference = {
	id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
	title: "Referência privada global",
	description: "Continua na biblioteca mesmo sem discovery da classificação.",
	author: "Fixture",
	authorAuthUserId: "fixture",
	createdAt: "2026-09-30T09:00:00.000Z",
	updatedAt: "2026-09-30T09:00:00.000Z",
	imageUrl:
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='12' viewBox='0 0 16 12'%3E%3Crect width='16' height='12' fill='%23d7aa61'/%3E%3C/svg%3E",
	width: 16,
	height: 12,
	mine: false,
	campaign: PRIVATE_CAMPAIGN,
};

type Props = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LembraCampaignE2EFixture({ searchParams }: Props) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const params = await searchParams;
	const canDiscoverPrivateCampaigns = params.private !== "0";
	return (
		<LembraCampaignFixtureClient
			canManageCampaigns={params.manage !== "0"}
			canDiscoverPrivateCampaigns={canDiscoverPrivateCampaigns}
			privateCampaign={canDiscoverPrivateCampaigns ? PRIVATE_CAMPAIGN : null}
			privateReference={
				canDiscoverPrivateCampaigns
					? PRIVATE_REFERENCE
					: { ...PRIVATE_REFERENCE, campaign: null }
			}
		/>
	);
}
