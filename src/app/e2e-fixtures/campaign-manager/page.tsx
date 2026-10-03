import { notFound } from "next/navigation";
import {
	CampaignManagementView,
	type CampaignManagerFeedback,
} from "@/features/campaigns/management-view";
import type { ManageableCampaign } from "@/features/campaigns/model";

export const dynamic = "force-dynamic";

const CAMPAIGNS: readonly ManageableCampaign[] = [
	{
		id: "11111111-1111-4111-8111-111111111111",
		technicalSlug: "yuhara-main",
		routeKey: "destino-sem-fim",
		name: "Destino Sem Fim",
		description: "A campanha principal da mesa.",
		lifecycle: "active",
		visibility: "public",
		archivedAt: null,
		updatedAt: "2026-10-03T00:00:00.000Z",
		coverImage: null,
		hasCoverBinding: false,
	},
	{
		id: "22222222-2222-4222-8222-222222222222",
		technicalSlug: "passos-retomados",
		routeKey: "passos-retomados",
		name: "Passos Retomados",
		description: null,
		lifecycle: "active",
		visibility: "private",
		archivedAt: null,
		updatedAt: "2026-10-03T00:01:00.000Z",
		coverImage: null,
		hasCoverBinding: false,
	},
	{
		id: "33333333-3333-4333-8333-333333333333",
		technicalSlug: "fixture-archived",
		routeKey: "fixture-archived",
		name: "Campanha arquivada de teste",
		description: "Fixture sintética para validar lifecycle sem tocar dados reais.",
		lifecycle: "archived",
		visibility: "private",
		archivedAt: "2026-10-02T12:00:00.000Z",
		updatedAt: "2026-10-03T00:02:00.000Z",
		coverImage: null,
		hasCoverBinding: false,
	},
];

type Props = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function queryValue(
	params: Record<string, string | string[] | undefined>,
	key: string,
) {
	const value = params[key];
	return typeof value === "string" ? value : null;
}

async function fixtureCampaignAction(_formData: FormData) {
	"use server";
}

export default async function CampaignManagerFixture({ searchParams }: Props) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();

	const params = await searchParams;
	const state = queryValue(params, "state");
	const longName = queryValue(params, "long") === "1";
	let campaigns =
		state === "zero" ? [] : state === "one" ? [CAMPAIGNS[0]] : [...CAMPAIGNS];
	if (longName && campaigns.length) {
		campaigns = campaigns.map((campaign, index) =>
			index === 0
				? {
						...campaign,
						name: "Destino Sem Fim — campanha sintética com um nome deliberadamente longo para validar quebra de linha e reflow",
					}
				: campaign,
		);
	}

	const feedback: CampaignManagerFeedback = {
		status: queryValue(params, "status"),
		error: queryValue(params, "erro"),
		field: queryValue(params, "campo"),
		campaignId: queryValue(params, "campanha"),
	};

	return (
		<CampaignManagementView
			campaigns={campaigns}
			feedback={feedback}
			returnTo={null}
			createAction={fixtureCampaignAction}
			updateAction={fixtureCampaignAction}
			lifecycleAction={fixtureCampaignAction}
		/>
	);
}
