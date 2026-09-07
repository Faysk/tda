import type { LoreProfileDTO } from "../model";
import { resolveLorePresentation } from "../presentation";

/**
 * Internal-only fixture for tests and component development.
 * It is deliberately non-canonical and is never returned by repository.ts.
 */
export const demoLoreProfile: LoreProfileDTO = {
	identity: {
		id: "demo-lore",
		slug: "demo-lore",
		entityType: "pc",
		name: "Lore Demo",
		eyebrow: "DEMO NÃO CANÔNICA",
		summary: "Fixture interna para validar leitura estática, cenas e narração.",
	},
	presentation: resolveLorePresentation({
		hero: {
			mode: "cinematic",
			initialSceneId: "intro",
		},
		scenes: [
			{ id: "intro", motion: { preset: "cinematic-soft" } },
			{ id: "turn", motion: { preset: "cinematic-push" } },
		],
	}),
	narration: {
		id: "demo-editorial-narration",
		kind: "editorial-narration",
		src: "/fixtures/lore-demo-narration.mp3",
		durationMs: 8000,
		beats: [
			{
				id: "beat-intro",
				startMs: 0,
				endMs: 4000,
				subtitle: "Trecho demonstrativo de legenda sincronizada.",
				sceneId: "intro",
			},
			{
				id: "beat-turn",
				startMs: 4000,
				endMs: 8000,
				subtitle: "A leitura abaixo continua disponível sem dar play.",
				sceneId: "turn",
			},
		],
	},
	sections: [
		{
			id: "overview",
			title: "Visão Geral",
			blocks: [
				{
					id: "demo-static-reading",
					kind: "prose",
					paragraphs: [
						"Este texto é fixture de interface, não lore da campanha.",
						"A narração é opcional: o conteúdo editorial permanece legível de forma estática.",
					],
				},
			],
		},
	],
};
