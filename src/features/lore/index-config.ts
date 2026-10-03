import { buildPublicMetadata } from "@/config/public-metadata";
import type {
	LoreCampaignContext,
	LoreRouteKind,
} from "./model";
import { loreIndexHref } from "./routes";

export type LoreIndexVisualKind =
	| "portrait"
	| "landscape"
	| "emblem"
	| "quest"
	| "music";

export type LoreIndexCopy = Readonly<{
	eyebrow: string;
	title: string;
	itemLabel: string;
	description: string;
	emptyTitle: string;
	emptyDescription: string;
	visualKind: LoreIndexVisualKind;
}>;

export const LORE_INDEX_COPY: Record<LoreRouteKind, LoreIndexCopy> = {
	personagens: {
		eyebrow: "Pessoas da mesa",
		title: "Personagens",
		itemLabel: "Personagem",
		description:
			"Perfis públicos dos personagens jogáveis da campanha, reunidos em um mesmo arquivo.",
		emptyTitle: "Nenhum personagem publicado ainda.",
		emptyDescription:
			"Quando houver um perfil público nesta campanha, ele aparece aqui.",
		visualKind: "portrait",
	},
	npcs: {
		eyebrow: "Pessoas do mundo",
		title: "NPCs",
		itemLabel: "NPC",
		description:
			"Perfis públicos das pessoas que cruzaram o caminho da campanha e ganharam espaço na história.",
		emptyTitle: "Nenhum NPC publicado ainda.",
		emptyDescription:
			"As pessoas desta campanha aparecem aqui quando seus perfis estiverem disponíveis para leitura.",
		visualKind: "portrait",
	},
	lugares: {
		eyebrow: "Geografia da memória",
		title: "Lugares",
		itemLabel: "Lugar",
		description:
			"Territórios, cidades e destinos publicados que fazem parte das memórias da campanha.",
		emptyTitle: "Nenhum lugar publicado ainda.",
		emptyDescription:
			"Os lugares desta campanha aparecem aqui quando estiverem disponíveis para explorar.",
		visualKind: "landscape",
	},
	faccoes: {
		eyebrow: "Forças em movimento",
		title: "Facções",
		itemLabel: "Facção",
		description:
			"Facções publicadas que ajudam a explicar alianças, conflitos e movimentos do mundo.",
		emptyTitle: "Nenhuma facção publicada ainda.",
		emptyDescription:
			"As facções desta campanha aparecem aqui quando houver um perfil público para elas.",
		visualKind: "emblem",
	},
	musicas: {
		eyebrow: "Sons da jornada",
		title: "Músicas",
		itemLabel: "Música",
		description:
			"Músicas publicadas ligadas às memórias e momentos da campanha.",
		emptyTitle: "Nenhuma música publicada ainda.",
		emptyDescription:
			"As músicas desta campanha aparecem aqui quando estiverem disponíveis para ouvir e explorar.",
		visualKind: "music",
	},
	quests: {
		eyebrow: "Caminhos em aberto",
		title: "Quests",
		itemLabel: "Quest",
		description:
			"Quests publicadas e autorizadas para navegação no arquivo da campanha.",
		emptyTitle: "Nenhuma quest publicada ainda.",
		emptyDescription:
			"As quests desta campanha aparecem aqui quando houver algo publicado para acompanhar.",
		visualKind: "quest",
	},
};

export function loreIndexMetadata(
	routeKind: LoreRouteKind,
	campaign?: LoreCampaignContext,
) {
	const copy = LORE_INDEX_COPY[routeKind];
	return buildPublicMetadata({
		title: campaign ? `${copy.title} — ${campaign.name}` : copy.title,
		description: copy.description,
		pathname: loreIndexHref(routeKind, campaign?.routeKey),
	});
}
