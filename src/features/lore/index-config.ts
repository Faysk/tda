import { buildPublicMetadata } from "@/config/public-metadata";
import type { LoreRouteKind } from "./model";

export type LoreIndexCopy = Readonly<{
	eyebrow: string;
	title: string;
	description: string;
	emptyTitle: string;
	emptyDescription: string;
}>;

export const LORE_INDEX_COPY: Record<LoreRouteKind, LoreIndexCopy> = {
	personagens: {
		eyebrow: "Pessoas da mesa",
		title: "Personagens",
		description:
			"Perfis públicos dos personagens jogáveis da campanha, reunidos em um mesmo arquivo.",
		emptyTitle: "Nenhum personagem publicado ainda.",
		emptyDescription:
			"Quando um perfil for aprovado para a web, ele passa a aparecer aqui.",
	},
	npcs: {
		eyebrow: "Pessoas do mundo",
		title: "NPCs",
		description:
			"Perfis públicos das pessoas que cruzaram o caminho da campanha e ganharam espaço na história.",
		emptyTitle: "Nenhum NPC publicado ainda.",
		emptyDescription:
			"Este arquivo só mostra perfis explicitamente aprovados para publicação pública.",
	},
	lugares: {
		eyebrow: "Geografia da memória",
		title: "Lugares",
		description:
			"Territórios, cidades e destinos publicados que fazem parte das memórias da campanha.",
		emptyTitle: "Nenhum lugar publicado ainda.",
		emptyDescription:
			"Os lugares aparecem aqui conforme recebem uma projection pública aprovada.",
	},
	faccoes: {
		eyebrow: "Forças em movimento",
		title: "Facções",
		description:
			"Facções publicadas que ajudam a explicar alianças, conflitos e movimentos do mundo.",
		emptyTitle: "Nenhuma facção publicada ainda.",
		emptyDescription:
			"Somente grupos com visibilidade pública explícita entram neste arquivo.",
	},
	musicas: {
		eyebrow: "Sons da jornada",
		title: "Músicas",
		description:
			"Músicas publicadas ligadas às memórias e momentos da campanha.",
		emptyTitle: "Nenhuma música publicada ainda.",
		emptyDescription:
			"Quando uma música ganhar publicação própria, ela poderá ser explorada por aqui.",
	},
	quests: {
		eyebrow: "Caminhos em aberto",
		title: "Quests",
		description:
			"Quests publicadas e autorizadas para navegação no arquivo da campanha.",
		emptyTitle: "Nenhuma quest publicada ainda.",
		emptyDescription:
			"O arquivo permanece vazio até existir conteúdo explicitamente autorizado para a web.",
	},
};

export function loreIndexMetadata(routeKind: LoreRouteKind) {
	const copy = LORE_INDEX_COPY[routeKind];
	return buildPublicMetadata({
		title: copy.title,
		description: copy.description,
		pathname: `/${routeKind}`,
	});
}
