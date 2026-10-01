import type { Metadata } from "next";
import Link from "next/link";
import { SessionList } from "@/components/session-list";
import { buildPublicMetadata } from "@/config/public-metadata";
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
	let sessions: Awaited<ReturnType<typeof listPublishedSessionArchive>> | undefined;
	try {
		sessions = await listPublishedSessionArchive();
	} catch {
		sessions = undefined;
	}

	const summary = sessions?.length
		? summarizeSessionArchive(sessions, { qualifyArcsByCampaign: true })
		: null;

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
							Todas as memórias publicadas do TDA, reunidas em um único
							arquivo. Use o filtro para entrar em uma campanha sem perder a
							visão geral.
						</p>
						<nav
							className={styles.scopeActions}
							aria-label="Explorar o arquivo global"
						>
							<Link className={styles.scopeAction} href="/campanhas">
								Ver campanhas
							</Link>
						</nav>
					</header>

					{summary ? (
						<dl
							className={styles.stats}
							aria-label="Resumo de todas as campanhas"
						>
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
						<SessionList sessions={sessions} showCampaignFilter />
					) : (
						<p className={styles.state}>Nenhuma sessão publicada ainda.</p>
					)}
				</div>
			</section>
		</div>
	);
}
