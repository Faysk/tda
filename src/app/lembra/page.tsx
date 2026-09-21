import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authorizeLembraView } from "@/features/lembra/access";
import { LembraExperience } from "@/features/lembra/components/lembra-experience";
import { loadLembraReferences } from "@/features/lembra/repository";
import { lembraPersistenceEnabled } from "@/features/lembra/server";

export const metadata: Metadata = {
	title: "Lembra",
	description:
		"Referências visuais compartilhadas para guardar e reencontrar ideias da campanha.",
};

export default async function LembraPage() {
	if (!lembraPersistenceEnabled()) {
		return <LembraExperience />;
	}

	const access = await authorizeLembraView();
	if (!access.ok) {
		if (access.reason === "unauthenticated") {
			redirect("/entrar?next=%2Flembra");
		}
		if (access.reason === "dependency_unavailable") {
			redirect("/conta?acesso=indisponivel");
		}
		redirect("/conta?acesso=negado");
	}

	const references = await loadLembraReferences(access.profileId);
	return (
		<LembraExperience
			initialReferences={references}
			persistenceEnabled
			canWrite={access.canWrite}
		/>
	);
}
