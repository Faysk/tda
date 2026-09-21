import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLembraIdentity } from "@/features/lembra/access";
import { LembraExperience } from "@/features/lembra/components/lembra-experience";
import {
	loadLembraFavoriteIds,
	loadLembraReferences,
} from "@/features/lembra/repository";
import { lembraPersistenceEnabled } from "@/features/lembra/server";

export const metadata: Metadata = {
	title: "Lembra",
	description:
		"Referências visuais compartilhadas para guardar e reencontrar ideias.",
};

export default async function LembraPage() {
	if (!lembraPersistenceEnabled()) {
		return <LembraExperience />;
	}

	const access = await getLembraIdentity();
	if (!access.ok) {
		if (access.reason === "unauthenticated") {
			redirect("/entrar?next=%2Flembra");
		}
		redirect("/conta?acesso=indisponivel");
	}

	const [references, favoriteIds] = await Promise.all([
		loadLembraReferences(access.identity.authUserId),
		loadLembraFavoriteIds(access.identity.authUserId),
	]);
	const activeIds = new Set(references.map((reference) => reference.id));

	return (
		<LembraExperience
			initialReferences={references}
			initialFavoriteIds={favoriteIds.filter((id) => activeIds.has(id))}
			persistenceEnabled
		/>
	);
}
