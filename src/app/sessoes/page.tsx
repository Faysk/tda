import { SessionList } from "@/components/session-list";
import { DisplayTitle, Eyebrow } from "@/components/ui";
import { buildPublicMetadata } from "@/config/public-metadata";
import { listPublishedSessions } from "@/features/sessions/repository";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata = buildPublicMetadata({
	title: "Sessões",
	description:
		"Arquivo público das sessões, histórias e memórias da campanha no TDA — Tem Dado Aqui.",
	pathname: "/sessoes",
});

export default async function Sessions() {
	let sessions: Awaited<ReturnType<typeof listPublishedSessions>> | undefined;
	try {
		sessions = await listPublishedSessions();
	} catch {
		sessions = undefined;
	}

	return (
		<section className="page-section">
			<header className={styles.header}>
				<Eyebrow>Arquivo da campanha</Eyebrow>
				<DisplayTitle className={styles.title}>As histórias até aqui</DisplayTitle>
			</header>

			{sessions === undefined ? (
				<p className={styles.state} role="status">
					Não foi possível carregar as sessões. Tente novamente em instantes.
				</p>
			) : sessions === null ? (
				<p className={styles.state}>Estamos preparando o arquivo da campanha.</p>
			) : sessions.length ? (
				<SessionList sessions={sessions} />
			) : (
				<p className={styles.state}>Nenhuma sessão publicada ainda.</p>
			)}
		</section>
	);
}
