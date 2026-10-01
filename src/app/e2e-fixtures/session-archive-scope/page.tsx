import { notFound } from "next/navigation";
import {
	SessionList,
	type SessionCampaignOption,
} from "@/components/session-list";
import type { SessionArchiveItem } from "@/features/sessions/archive";

export const dynamic = "force-dynamic";

const CAMPAIGN_A: SessionCampaignOption = {
	slug: "fixture-only-campaign",
	name: "Campanha Única de Teste",
};

const CAMPAIGN_B: SessionCampaignOption = {
	slug: "fixture-with-content",
	name: "Campanha com Conteúdo",
};

const ONE_CAMPAIGN_SESSIONS: readonly SessionArchiveItem[] = Array.from(
	{ length: 13 },
	(_, index) => ({
		id: `fixture-session-${String(index + 1).padStart(2, "0")}`,
		campaignId: "fixture-only-campaign-id",
		campaignSlug: CAMPAIGN_A.slug,
		campaignName: CAMPAIGN_A.name,
		campaignTechnicalSlug: CAMPAIGN_A.slug,
		title: `Memória sintética ${index + 1}`,
		date: `2026-09-${String(13 - index).padStart(2, "0")}`,
		arc: index % 2 === 0 ? "Arco Compartilhado" : "Arco Alternado",
		summary: "Conteúdo sintético para o contrato de escopo do arquivo.",
	}),
);

const OTHER_CAMPAIGN_SESSIONS: readonly SessionArchiveItem[] = [
	{
		id: "fixture-other-session",
		campaignId: "fixture-with-content-id",
		campaignSlug: CAMPAIGN_B.slug,
		campaignName: CAMPAIGN_B.name,
		campaignTechnicalSlug: CAMPAIGN_B.slug,
		title: "A única memória da outra campanha",
		date: "2026-09-30",
		arc: "Arco Compartilhado",
		summary: "A campanha A fica vazia enquanto esta campanha mantém conteúdo.",
	},
];

export default function SessionArchiveScopeFixture() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();

	return (
		<main>
			<section data-session-scope-fixture="one-campaign">
				<h1>Uma campanha, treze sessões</h1>
				<SessionList
					sessions={ONE_CAMPAIGN_SESSIONS}
					showCampaignFilter
					campaignOptions={[CAMPAIGN_A]}
				/>
			</section>

			<section data-session-scope-fixture="empty-campaign">
				<h2>Campanha vazia ao lado de outra com conteúdo</h2>
				<SessionList
					sessions={OTHER_CAMPAIGN_SESSIONS}
					showCampaignFilter
					campaignOptions={[CAMPAIGN_A, CAMPAIGN_B]}
				/>
			</section>
		</main>
	);
}
