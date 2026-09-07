import Image from "next/image";
import Link from "next/link";
import { SessionList } from "@/components/session-list";
import {
	ActionLink,
	BodyCopy,
	DisplayTitle,
	Eyebrow,
	SectionTitle,
} from "@/components/ui";
import { listPublishedSessions } from "@/features/sessions/repository";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export default async function Home() {
	let sessions: Awaited<ReturnType<typeof listPublishedSessions>> | undefined;
	try {
		sessions = await listPublishedSessions();
	} catch {
		sessions = undefined;
	}
	const latest = sessions?.[0];
	const heroImage = latest?.heroImage || latest?.coverImage;

	return (
		<div className={styles.home}>
			<section
				className={`${styles.hero}${heroImage ? ` ${styles.heroWithArt}` : ""}`}
			>
				{heroImage ? (
					<>
						<Image
							className={styles.heroArt}
							src={heroImage}
							alt=""
							fill
							priority
							sizes="(max-width: 1200px) 100vw, 1200px"
						/>
						<div className={styles.heroOverlay} aria-hidden="true" />
					</>
				) : null}
				<div className={styles.heroCopy}>
					<Eyebrow className={styles.heroEyebrow}>
						Nosso mundo, nossas histórias
					</Eyebrow>
					<DisplayTitle className={styles.heroTitle}>
						Toda jornada
						<br />
						deixa uma história.
					</DisplayTitle>
					<BodyCopy className={styles.heroBody}>
						Entre encontros improváveis e decisões que mudam destinos, guardamos
						as memórias da nossa mesa.
					</BodyCopy>
					<div className={styles.heroActions}>
						<ActionLink href="/sessoes" variant="primary">
							Explorar as sessões <span aria-hidden="true">↗</span>
						</ActionLink>
						{latest ? (
							<Link
								className={styles.heroLatest}
								href={`/sessoes/${encodeURIComponent(latest.id)}`}
							>
								<span className={styles.heroLatestLabel}>Última memória</span>
								<strong className={styles.heroLatestTitle}>{latest.title}</strong>
							</Link>
						) : null}
					</div>
				</div>
				<div className={styles.heroRule} aria-hidden="true" />
			</section>

			<section className={styles.memories}>
				<div className={styles.sectionHeading}>
					<div>
						<Eyebrow>O que vivemos juntos</Eyebrow>
						<SectionTitle className={styles.sectionTitle}>
							Memórias da campanha
						</SectionTitle>
					</div>
					<Link className={styles.sectionLink} href="/sessoes">
						Ver todas <span aria-hidden="true">→</span>
					</Link>
				</div>
				{sessions === undefined ? (
					<p className={styles.state} role="status">
						Não foi possível carregar as memórias. Tente novamente em instantes.
					</p>
				) : sessions === null ? (
					<p className={styles.state}>
						Estamos preparando o arquivo de histórias da campanha.
					</p>
				) : sessions.length ? (
					<SessionList sessions={sessions.slice(0, 4)} featuredFirst />
				) : (
					<p className={styles.state}>Nenhuma sessão publicada ainda.</p>
				)}
			</section>
		</div>
	);
}
