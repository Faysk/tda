import type { Metadata } from "next";
import { SessionList } from "@/components/session-list";
import { buildPublicMetadata } from "@/config/public-metadata";
import { readPublicCampaignDirectory } from "@/features/campaigns/server";
import {
	formatArchiveDate,
	formatArchiveNumber,
	summarizeSessionArchive,
} from "@/features/sessions/archive";
import { listPublishedSessionArchive } from "@/features/sessions/repository";
import styles from "../../sessoes/page.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = buildPublicMetadata({
	title: "Sessões",
	description: "Arquivo público de sessões publicadas de todas as campanhas.",
	pathname: "/campanhas/sessoes",
});

export default async function CampaignSessionsArchive() {
	const [sessionsResult, campaignsResult] = await Promise.allSettled([
		listPublishedSessionArchive(),
		readPublicCampaignDirectory(),
	]);

	const sessions =
		sessionsResult.status === "fulfilled" ? sessionsResult.value : undefined;
	const campaignOptions =
		campaignsResult.status === "fulfilled" && campaignsResult.value.ok
			? campaignsResult.value.campaigns.map((campaign) => ({
					slug: campaign.routeKey,
					name: campaign.name,
				}))
			: undefined;

	const summary =
		Array.isArray(sessions)
			? summarizeSessionArchive(sessions, { qualifyArcsByCampaign: true })
			: null;
	const campaignCount =
		campaignOptions?.length ??
		(Array.isArray(sessions)
			? new Set(sessions.map((session) => session.campaignSlug)).size
			: 0);

	return (
		<div
			className={styles.page}
			data-layout-family="editorial"
			data-layout-role="expansive"
			data-session-archive-scope="aggregate"
		>
			<section
				className={`${styles.hero} ${styles.aggregateHero}`}
				aria-labelledby="archive-title"
				data-session-archive-hero
			>
				<div className={styles.backdropShade} aria-hidden="true" />
				<div className={styles.heroInner}>
					<header className={styles.heroCopy}>
						<p className={styles.eyebrow}>Arquivo global</p>
						<h1 className={styles.title} id="archive-title">
							Todas as campanhas
						</h1>
						<p>
							Sessões publicadas de todas as campanhas do TDA, reunidas em um
							único arquivo. Filtre ou entre em uma campanha específica sem
							perder a visão geral.
						</p>
					</header>

					{summary ? (
						<dl
							className={styles.stats}
							aria-label="Resumo de todas as campanhas"
						>
							<div className={styles.stat}>
								<dt>campanhas públicas</dt>
								<dd>{formatArchiveNumber(campaignCount)}</dd>
							</div>
							<div className={styles.stat}>
								<dt>memórias no arquivo global</dt>
								<dd>{formatArchiveNumber(summary.sessions)}</dd>
							</div>
							<div className={styles.stat}>
								<dt>arcos entre campanhas</dt>
								<dd>{formatArchiveNumber(summary.arcs)}</dd>
							</div>
							<div className={styles.stat}>
								<dt>última memória do arquivo</dt>
								<dd>{formatArchiveDate(summary.latestDate)}</dd>
							</div>
						</dl>
					) : null}
				</div>
			</section>

			<section
				className={styles.archive}
				aria-label="Sessões publicadas de todas as campanhas"
			>
				<div className={styles.archiveRail} data-session-archive-rail>
					{sessions === undefined ? (
						<p className={styles.state}>
							Não foi possível carregar as sessões. Tente novamente em
							instantes.
						</p>
					) : sessions === null ? (
						<p className={styles.state}>
							Estamos preparando o arquivo de campanhas.
						</p>
					) : sessions.length ? (
						<SessionList
							sessions={sessions}
							showCampaignFilter
							campaignOptions={campaignOptions}
						/>
					) : (
						<p className={styles.state}>Nenhuma sessão publicada ainda.</p>
					)}
				</div>
			</section>
		</div>
	);
}
