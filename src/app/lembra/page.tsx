import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canCurrentUserManageCampaigns } from "@/features/campaigns/server";
import { getLembraIdentity } from "@/features/lembra/access";
import { loadDiscoverableLembraCampaigns } from "@/features/lembra/campaign-discovery";
import { LembraExperience } from "@/features/lembra/components/lembra-experience";
import {
	loadLembraFavoriteIds,
	loadLembraReferences,
} from "@/features/lembra/repository";
import { lembraPersistenceEnabled } from "@/features/lembra/server";

export const dynamic = "force-dynamic";

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

	const campaignsPromise = loadDiscoverableLembraCampaigns();
	const favoriteIdsPromise = loadLembraFavoriteIds(access.identity.authUserId);
	const canManageCampaignsPromise = canCurrentUserManageCampaigns();
	const campaigns = await campaignsPromise;
	const [references, favoriteIds, canManageCampaigns] = await Promise.all([
		loadLembraReferences(access.identity.authUserId, campaigns),
		favoriteIdsPromise,
		canManageCampaignsPromise,
	]);
	const activeIds = new Set(references.map((reference) => reference.id));

	return (
		<LembraExperience
			initialReferences={references}
			initialFavoriteIds={favoriteIds.filter((id) => activeIds.has(id))}
			initialCampaigns={campaigns}
			canManageCampaigns={canManageCampaigns}
			persistenceEnabled
		/>
	);
}
