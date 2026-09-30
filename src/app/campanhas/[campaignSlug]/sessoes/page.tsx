import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SessionList } from "@/components/session-list";
import { buildPublicMetadata } from "@/config/public-metadata";
import { resolvePublicCampaignRoute } from "@/features/campaigns/server";
import {
	formatArchiveDate,
	formatArchiveNumber,
	summarizeSessionArchive,
} from "@/features/sessions/archive";
import {
	LEGACY_CAMPAIGN_NAME,
	LEGACY_CAMPAIGN_PUBLIC_SLUG,
} from "@/features/sessions/model";
import { listPublishedSessionArchive } from "@/features/sessions/repository";
import styles from "../../../sessoes/page.module.css";

export const dynamic = "force-dynamic";

type Props = {
	params: Promise<{ campaignSlug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { campaignSlug } = await params;
	const resolved = await resolvePublicCampaignRoute(campaignSlug);

	if (resolved.ok) {
		return buildPublicMetadata({
			title: `Sessões — ${resolved.campaign.name}`,
			description:
				resolved.campaign.description ||
				`Arquivo público de sessões de ${resolved.campaign.name}.`,
			pathname: `/campanhas/${resolved.campaign.routeKey}/sessoes`,
		});
	}

	if (
		resolved.reason === "dependency_unavailable" &&
		campaignSlug === LEGACY_CAMPAIGN_PUBLIC_SLUG
	) {
		return buildPublicMetadata({
			title: `Sessões — ${LEGACY_CAMPAIGN_NAME}`,
			description: `Arquivo público de sessões de ${LEGACY_CAMPAIGN_NAME}.`,
			pathname: `/campanhas/${LEGACY_CAMPAIGN_PUBLIC_SLUG}/sessoes`,
		});
	}

	return buildPublicMetadata({
		title: "Sessões",
		description: "Arquivo público de sessões da campanha.",
		pathname: `/campanhas/${encodeURIComponent(campaignSlug)}/sessoes`,
	});
}

export default async function CampaignSessionsPage({ params }: Props) {
	const { campaignSlug } = await params;
	const resolved = await resolvePublicCampaignRoute(campaignSlug);

	let routeKey = campaignSlug;
	let campaignName = LEGACY_CAMPAIGN_NAME;
	let campaignDescription: string | null = null;

	if (resolved.ok) {
		if (!resolved.canonical) {
			redirect(`/campanhas/${resolved.campaign.routeKey}/sessoes`);
		}
		routeKey = resolved.campaign.routeKey;
		campaignName = resolved.campaign.name;
		campaignDescription = resolved.campaign.description;
	} else if (resolved.reason === "not_found") {
		notFound();
	} else if (campaignSlug !== LEGACY_CAMPAIGN_PUBLIC_SLUG) {
		return (
			<main className={styles.page}>
				<p className={styles.state} role="status">
					Não foi possível carregar as sessões desta campanha agora.
				</p>
			</main>
		);
	}

	let sessions: Awaited<ReturnType<typeof listPublishedSessionArchive>>;
	try {
		sessions = await listPublishedSessionArchive(routeKey);
	} catch {
		return (
			<main className={styles.page}>
				<p className={styles.state} role="status">
					Não foi possível carregar as sessões desta campanha agora.
				</p>
			</main>
		);
	}

	if (sessions === null) {
		return (
			<main className={styles.page}>
				<p className={styles.state} role="status">
					Estamos preparando o arquivo da campanha.
				</p>
			</main>
		);
	}

	if (sessions[0]) {
		campaignName = sessions[0].campaignName;
	}

	const summary = summarizeSessionArchive(sessions);

	return (
		<div
			className={styles.page}
			data-layout-family="editorial"
			data-layout-role="expansive"
		>
			<section className={styles.hero} aria-labelledby="archive-title">
				<div className={styles.backdropShade} aria-hidden="true" />
				<div className={styles.heroInner}>
					<header className={styles.heroCopy}>
						<p className={styles.eyebrow}>Arquivo da campanha</p>
						<h1 className={styles.title} id="archive-title">
							{campaignName}
						</h1>
						<p>
							{campaignDescription ||
								"Sessões e memórias publicadas desta campanha."}
						</p>
					</header>
					<dl className={styles.stats} aria-label="Resumo público do arquivo">
						<div className={styles.stat}>
							<dt>memórias publicadas</dt>
							<dd>{formatArchiveNumber(summary.sessions)}</dd>
						</div>
						<div className={styles.stat}>
							<dt>arcos registrados</dt>
							<dd>{formatArchiveNumber(summary.arcs)}</dd>
						</div>
						<div className={styles.stat}>
							<dt>primeira memória</dt>
							<dd>{formatArchiveDate(summary.firstDate)}</dd>
						</div>
						<div className={styles.stat}>
							<dt>última memória</dt>
							<dd>{formatArchiveDate(summary.latestDate)}</dd>
						</div>
					</dl>
				</div>
			</section>

			<section className={styles.archive} aria-label="Sessões publicadas">
				<div className={styles.archiveRail}>
					{sessions.length === 0 ? (
						<div className={styles.state}>
							<h2>Nenhuma sessão publicada ainda</h2>
							<p>
								Quando esta campanha publicar sua primeira memória, ela aparece aqui.
							</p>
						</div>
					) : (
						<SessionList sessions={sessions} />
					)}
				</div>
			</section>
		</div>
	);
}
