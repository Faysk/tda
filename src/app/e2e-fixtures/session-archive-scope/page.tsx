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

const ARC_IDENTITY_SCOPED_SESSIONS: readonly SessionArchiveItem[] = [
	{
		id: "fixture-arc-upper",
		campaignId: "fixture-only-campaign-id",
		campaignSlug: CAMPAIGN_A.slug,
		campaignName: CAMPAIGN_A.name,
		campaignTechnicalSlug: CAMPAIGN_A.slug,
		title: "Valcinzento em caixa alta",
		date: "2026-10-04",
		arc: "VALCINZENTO E O CORAÇÃO-RAIZ",
		summary: "Variação sintética em caixa alta.",
	},
	{
		id: "fixture-arc-title",
		campaignId: "fixture-only-campaign-id",
		campaignSlug: CAMPAIGN_A.slug,
		campaignName: CAMPAIGN_A.name,
		campaignTechnicalSlug: CAMPAIGN_A.slug,
		title: "Valcinzento editorial",
		date: "2026-10-03",
		arc: "Valcinzento e o Coração-Raiz",
		summary: "Variação sintética em grafia editorial.",
	},
	{
		id: "fixture-arc-trim",
		campaignId: "fixture-only-campaign-id",
		campaignSlug: CAMPAIGN_A.slug,
		campaignName: CAMPAIGN_A.name,
		campaignTechnicalSlug: CAMPAIGN_A.slug,
		title: "Valcinzento com espaços externos",
		date: "2026-10-02",
		arc: "  Valcinzento e o Coração-Raiz  ",
		summary: "Variação sintética com trim necessário.",
	},
	{
		id: "fixture-arc-unicode",
		campaignId: "fixture-only-campaign-id",
		campaignSlug: CAMPAIGN_A.slug,
		campaignName: CAMPAIGN_A.name,
		campaignTechnicalSlug: CAMPAIGN_A.slug,
		title: "Valcinzento em Unicode decomposto",
		date: "2026-10-01",
		arc: "Valcinzento e o Coração-Raiz",
		summary: "Variação sintética com Unicode canonicamente equivalente.",
	},
	{
		id: "fixture-arc-thalindra",
		campaignId: "fixture-only-campaign-id",
		campaignSlug: CAMPAIGN_A.slug,
		campaignName: CAMPAIGN_A.name,
		campaignTechnicalSlug: CAMPAIGN_A.slug,
		title: "Thalindra permanece distinta",
		date: "2026-09-30",
		arc: "Thalindra",
		summary: "Nome sintético que não pode sofrer fuzzy merge.",
	},
	{
		id: "fixture-arc-talindra",
		campaignId: "fixture-only-campaign-id",
		campaignSlug: CAMPAIGN_A.slug,
		campaignName: CAMPAIGN_A.name,
		campaignTechnicalSlug: CAMPAIGN_A.slug,
		title: "Talindra permanece distinta",
		date: "2026-09-29",
		arc: "Talindra",
		summary: "Outro nome sintético que continua distinto.",
	},
];

const ARC_IDENTITY_AGGREGATE_SESSIONS: readonly SessionArchiveItem[] = [
	...ARC_IDENTITY_SCOPED_SESSIONS,
	{
		id: "fixture-arc-other-campaign",
		campaignId: "fixture-with-content-id",
		campaignSlug: CAMPAIGN_B.slug,
		campaignName: CAMPAIGN_B.name,
		campaignTechnicalSlug: CAMPAIGN_B.slug,
		title: "Valcinzento na segunda campanha",
		date: "2026-10-05",
		arc: "Valcinzento e o Coração-Raiz",
		summary: "Mesmo título de arco, outra identidade de campanha.",
	},
];

export default function SessionArchiveScopeFixture() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();

	return (
		<section>
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

			<section data-session-scope-fixture="arc-identity-scoped">
				<h2>Identidade normalizada de arco em uma campanha</h2>
				<SessionList sessions={ARC_IDENTITY_SCOPED_SESSIONS} />
			</section>

			<section data-session-scope-fixture="arc-identity-aggregate">
				<h2>Identidade de arco qualificada por campanha</h2>
				<SessionList
					sessions={ARC_IDENTITY_AGGREGATE_SESSIONS}
					showCampaignFilter
					campaignOptions={[CAMPAIGN_A, CAMPAIGN_B]}
				/>
			</section>
		</section>
	);
}
