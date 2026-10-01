import { notFound } from "next/navigation";
import { LoreIndexArchive } from "@/features/lore/components/lore-index-page";
import type { LoreCampaignContext, LoreEntityType, LoreRouteKind } from "@/features/lore/model";
import type { LoreIndexItem } from "@/features/lore/public-projection";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
	kind?: string | string[];
	scenario?: string | string[];
}>;

const ROUTE_KINDS: readonly LoreRouteKind[] = [
	"personagens",
	"npcs",
	"lugares",
	"faccoes",
	"quests",
	"musicas",
];

const FIXTURE_CAMPAIGN: LoreCampaignContext = {
	routeKey: "fixture-campaign",
	technicalSlug: "fixture-campaign-tech",
	name: "Campanha sintética",
};

const ENTITY_TYPE_BY_ROUTE: Readonly<Record<LoreRouteKind, LoreEntityType>> = {
	personagens: "pc",
	npcs: "npc",
	lugares: "location",
	faccoes: "faction",
	quests: "quest",
	musicas: "song",
};

function first(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

function routeKind(value: string | undefined): LoreRouteKind {
	return ROUTE_KINDS.includes(value as LoreRouteKind)
		? (value as LoreRouteKind)
		: "personagens";
}

function fixtureVisual(name: string) {
	const svg = encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#15191f"/><stop offset="1" stop-color="#8a6b34"/></linearGradient></defs><rect width="1200" height="900" fill="url(#g)"/><circle cx="760" cy="360" r="180" fill="#d0ad67" opacity=".5"/><text x="80" y="790" fill="#f4ead7" font-size="72" font-family="serif">${name}</text></svg>`,
	);
	return {
		src: `data:image/svg+xml;charset=utf-8,${svg}`,
		alt: `Arte sintética de ${name}`,
		focalPoint: { x: 64, y: 40 },
	};
}

function fixtureItem(
	kind: LoreRouteKind,
	index: number,
	options: Readonly<{
		summary?: boolean;
		media?: boolean;
		longTitle?: boolean;
	}> = {},
): LoreIndexItem {
	const name = options.longTitle
		? "A Cartógrafa das Sete Fronteiras e dos Caminhos que Ninguém Lembra"
		: `Memória sintética ${index + 1}`;
	const slug = `fixture-${index + 1}`;
	return {
		slug,
		entityType: ENTITY_TYPE_BY_ROUTE[kind],
		name,
		summary:
			options.summary === false
				? ""
				: "Uma descrição pública sintética para validar densidade, hierarquia e comportamento responsivo sem depender de dados reais.",
		href: `/campanhas/${FIXTURE_CAMPAIGN.routeKey}/${kind}/${slug}`,
		campaign: FIXTURE_CAMPAIGN,
		...(options.media ? { visual: fixtureVisual(name) } : {}),
	};
}

function scenarioItems(
	kind: LoreRouteKind,
	scenario: string | undefined,
): readonly LoreIndexItem[] {
	switch (scenario) {
		case "empty":
			return [];
		case "one":
			return [fixtureItem(kind, 0)];
		case "no-summary":
			return [fixtureItem(kind, 0, { summary: false })];
		case "with-media":
			return [fixtureItem(kind, 0, { media: true })];
		case "no-media":
			return [fixtureItem(kind, 0, { media: false })];
		case "long-title":
			return [fixtureItem(kind, 0, { longTitle: true })];
		default:
			return Array.from({ length: 12 }, (_, index) =>
				fixtureItem(kind, index, {
					media: index % 3 === 0,
					summary: index % 4 !== 0,
					longTitle: index === 7,
				}),
			);
	}
}

export default async function LoreCatalogE2EFixture({
	searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const params = await searchParams;
	const kind = routeKind(first(params.kind));
	const items = scenarioItems(kind, first(params.scenario));
	return (
		<LoreIndexArchive
			routeKind={kind}
			campaign={FIXTURE_CAMPAIGN}
			items={items}
		/>
	);
}
