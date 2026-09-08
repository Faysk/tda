import Image from "next/image";
import { SessionList } from "@/components/session-list";
import { Eyebrow } from "@/components/ui";
import { buildPublicMetadata } from "@/config/public-metadata";
import {
	formatArchiveDuration,
	formatArchiveNumber,
	summarizeSessionArchive,
} from "@/features/sessions/archive";
import { listPublishedSessionArchive } from "@/features/sessions/repository";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata = buildPublicMetadata({
	title: "Sessões",
	description:
		"Arquivo público das sessões, histórias e memórias da campanha no TDA — Tem Dado Aqui.",
	pathname: "/sessoes",
});

function Coverage({
	value,
	label,
	detail,
}: {
	value: string;
	label: string;
	detail?: string;
}) {
	return (
		<div className={styles.stat}>
			<dt>{label}</dt>
			<dd>{value}</dd>
			{detail ? <span>{detail}</span> : null}
		</div>
	);
}

export default async function Sessions() {
	let sessions: Awaited<ReturnType<typeof listPublishedSessionArchive>> | undefined;
	try {
		sessions = await listPublishedSessionArchive();
	} catch {
		sessions = undefined;
	}

	const latest = sessions?.[0];
	const artwork = latest?.heroImage || latest?.coverImage;
	const summary = sessions?.length ? summarizeSessionArchive(sessions) : null;
	const coverage = (known: number) =>
		summary && known < summary.sessions
			? `${known} de ${summary.sessions} sessões`
			: undefined;

	return (
		<div className={styles.page}>
			<section className={styles.hero} aria-labelledby="archive-title">
				{artwork ? (
					<div className={styles.backdrop} aria-hidden="true">
						<Image
							className={styles.backdropImage}
							src={artwork}
							alt=""
							fill
							preload
							sizes="100vw"
						/>
					</div>
				) : null}
				<div className={styles.backdropShade} aria-hidden="true" />
				<div className={styles.heroInner}>
					<header className={styles.heroCopy}>
						<Eyebrow className={styles.eyebrow}>Arquivo da campanha</Eyebrow>
						<h1 className={styles.title} id="archive-title">
							As histórias até aqui
						</h1>
						<p>
							Todas as sessões, decisões e memórias da nossa jornada reunidas em
							um só lugar.
						</p>
					</header>

					{summary ? (
						<dl className={styles.stats} aria-label="Resumo do arquivo">
							<Coverage
								value={formatArchiveNumber(summary.sessions)}
								label="sessões"
							/>
							<Coverage
								value={formatArchiveDuration(summary.durationMs)}
								label="duração registrada"
								detail={coverage(summary.durationCoverage)}
							/>
							<Coverage
								value={formatArchiveNumber(summary.wordCount)}
								label="palavras"
								detail={coverage(summary.wordCoverage)}
							/>
							<Coverage
								value={formatArchiveNumber(summary.participantCount)}
								label="participações"
								detail={coverage(summary.participantCoverage)}
							/>
						</dl>
					) : null}
				</div>
			</section>

			<section className={styles.archive} aria-label="Sessões publicadas">
				{sessions === undefined ? (
					<p className={styles.state} role="status">
						Não foi possível carregar as sessões. Tente novamente em instantes.
					</p>
				) : sessions === null ? (
					<p className={styles.state}>
						Estamos preparando o arquivo da campanha.
					</p>
				) : sessions.length ? (
					<SessionList sessions={sessions} />
				) : (
					<p className={styles.state}>Nenhuma sessão publicada ainda.</p>
				)}
			</section>
		</div>
	);
}
