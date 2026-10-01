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
			"Quando um perfil for aprovado para a web, ele passa a aparecer aqui.",
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
			"Este arquivo só mostra perfis explicitamente aprovados para publicação pública.",
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
			"Os lugares aparecem aqui conforme recebem uma projection pública aprovada.",
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
			"Somente grupos com visibilidade pública explícita entram neste arquivo.",
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
			"Quando uma música ganhar publicação própria, ela poderá ser explorada por aqui.",
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
			"O arquivo permanece vazio até existir conteúdo explicitamente autorizado para a web.",
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
