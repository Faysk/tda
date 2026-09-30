import type { Metadata } from "next";
import { SessionList } from "@/components/session-list";
import { buildPublicMetadata } from "@/config/public-metadata";
import { formatArchiveDate, formatArchiveNumber, summarizeSessionArchive } from "@/features/sessions/archive";
import { listPublishedSessionArchive } from "@/features/sessions/repository";
import styles from "../../sessoes/page.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = buildPublicMetadata({
	title: "Sessões",
	description: "Arquivo público de sessões publicadas de todas as campanhas.",
	pathname: "/campanhas/sessoes",
});

export default async function CampaignSessionsArchive() {
	let sessions: Awaited<ReturnType<typeof listPublishedSessionArchive>> | undefined;
	try { sessions = await listPublishedSessionArchive(); } catch { sessions = undefined; }
	const summary = sessions?.length ? summarizeSessionArchive(sessions, { qualifyArcsByCampaign: true }) : null;
	return <div className={styles.page} data-layout-family="editorial" data-layout-role="expansive">
		<section className={styles.hero} aria-labelledby="archive-title" data-session-archive-hero>
			<div className={styles.backdropShade} aria-hidden="true" />
			<div className={styles.heroInner}>
				<header className={styles.heroCopy}>
					<p className={styles.eyebrow}>Arquivo de campanhas</p>
					<h1 className={styles.title} id="archive-title">As histórias até aqui</h1>
					<p>Sessões publicadas de todas as campanhas públicas, reunidas em um só arquivo.</p>
				</header>
				{summary ? <dl className={styles.stats} aria-label="Resumo público do arquivo">
					<div className={styles.stat}><dt>memórias publicadas</dt><dd>{formatArchiveNumber(summary.sessions)}</dd></div>
					<div className={styles.stat}><dt>arcos registrados</dt><dd>{formatArchiveNumber(summary.arcs)}</dd></div>
					<div className={styles.stat}><dt>primeira memória</dt><dd>{formatArchiveDate(summary.firstDate)}</dd></div>
					<div className={styles.stat}><dt>última memória</dt><dd>{formatArchiveDate(summary.latestDate)}</dd></div>
				</dl> : null}
			</div>
		</section>
		<section className={styles.archive} aria-label="Sessões publicadas"><div className={styles.archiveRail} data-session-archive-rail>
			{sessions === undefined ? <p className={styles.state}>Não foi possível carregar as sessões. Tente novamente em instantes.</p>
			: sessions === null ? <p className={styles.state}>Estamos preparando o arquivo de campanhas.</p>
			: sessions.length ? <SessionList sessions={sessions} showCampaignFilter />
			: <p className={styles.state}>Nenhuma sessão publicada ainda.</p>}
		</div></section>
	</div>;
}
