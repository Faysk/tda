import { notFound } from "next/navigation";
import { LorePage } from "@/features/lore/components/lore-page";
import type { LoreProfileDTO } from "@/features/lore/model";
import { resolveLorePresentation } from "@/features/lore/presentation";

export const dynamic = "force-dynamic";

const PROFILE: LoreProfileDTO = {
	identity: {
		id: "fixture-profile",
		slug: "fixture-profile",
		entityType: "pc",
		name: "A Cartógrafa do Horizonte",
		eyebrow: "Personagem",
		summary:
			"Uma personagem pública sintética usada apenas para provar que um perfil sem mídia continua editorial, contextual e compacto.",
	},
	presentation: resolveLorePresentation({
		motion: {
			preset: "still",
			intensity: 0,
			pointerParallax: false,
			scrollParallax: false,
		},
	}),
	sections: [
		{
			id: "overview",
			title: "Visão geral",
			blocks: [
				{
					id: "summary",
					kind: "prose",
					paragraphs: [
						"Este conteúdo sintético valida o ritmo de leitura sem depender de campanha, mídia privada ou projection de produção.",
					],
				},
			],
		},
	],
};

export default function LoreProfileE2EFixture() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	return <LorePage profile={PROFILE} />;
}
