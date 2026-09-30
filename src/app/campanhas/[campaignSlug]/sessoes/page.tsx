import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SessionList } from "@/components/session-list";
import { buildPublicMetadata } from "@/config/public-metadata";
import { resolvePublicCampaignRoute } from "@/features/campaigns/server";
import { listPublishedSessionsByCampaign } from "@/features/sessions/repository";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Props = {
	params: Promise<{ campaignSlug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { campaignSlug } = await params;
	const resolved = await resolvePublicCampaignRoute(campaignSlug);
	if (!resolved.ok) {
		return buildPublicMetadata({
			title: "Sessões",
			description: "Arquivo público de sessões do TDA.",
			pathname: `/campanhas/${campaignSlug}/sessoes`,
		});
	}

	return buildPublicMetadata({
		title: `Sessões · ${resolved.campaign.name}`,
		description:
			resolved.campaign.description ||
			`Arquivo público de sessões de ${resolved.campaign.name}.`,
		pathname: `/campanhas/${resolved.campaign.routeKey}/sessoes`,
	});
}

export default async function CampaignSessionsPage({ params }: Props) {
	const { campaignSlug } = await params;
	const resolved = await resolvePublicCampaignRoute(campaignSlug);
	if (!resolved.ok) {
		if (resolved.reason === "not_found") notFound();
		return (
			<main className={styles.page}>
				<section className={styles.state} role="status">
					<h1>Arquivo temporariamente indisponível</h1>
					<p>Não conseguimos resolver esta campanha agora. Tente novamente em instantes.</p>
				</section>
			</main>
		);
	}

	if (!resolved.canonical) {
		redirect(`/campanhas/${resolved.campaign.routeKey}/sessoes`);
	}

	let sessions: Awaited<ReturnType<typeof listPublishedSessionsByCampaign>>;
	try {
		sessions = await listPublishedSessionsByCampaign(
			resolved.campaign.technicalSlug,
		);
	} catch {
		sessions = null;
	}

	return (
		<main className={styles.page} data-layout-family="editorial">
			<header className={styles.header}>
				<p className={styles.eyebrow}>Campanha · sessões</p>
				<h1>{resolved.campaign.name}</h1>
				<p>
					{resolved.campaign.description ||
						"Arquivo público das memórias desta campanha."}
				</p>
			</header>

			<section className={styles.archive} aria-label="Sessões publicadas">
				{sessions === null ? (
					<div className={styles.state} role="status">
						<h2>Arquivo temporariamente indisponível</h2>
						<p>As sessões não puderam ser carregadas agora.</p>
					</div>
				) : sessions.length === 0 ? (
					<div className={styles.state}>
						<h2>Nenhuma sessão publicada ainda</h2>
						<p>Quando esta campanha publicar sua primeira memória, ela aparece aqui.</p>
					</div>
				) : (
					<SessionList sessions={sessions} />
				)}
			</section>
		</main>
	);
}
