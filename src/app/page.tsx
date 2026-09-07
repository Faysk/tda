import Image from "next/image";
import { PublicLink as Link } from "@/components/public-link";
import {
	ActionLink,
	BodyCopy,
	DisplayTitle,
	Eyebrow,
	SectionTitle,
} from "@/components/ui";
import { buildPublicMetadata, SITE_NAME } from "@/config/public-metadata";
import {
	formatSessionDate,
	type PublishedSession,
} from "@/features/sessions/model";
import { listPublishedSessions } from "@/features/sessions/repository";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export const metadata = buildPublicMetadata({
	title: SITE_NAME,
	description:
		"Um arquivo vivo das sessões, decisões e memórias que construímos juntos ao redor da mesa.",
	pathname: "/",
	absoluteTitle: true,
});

function SessionArtwork({
	session,
	preload = false,
}: {
	session: PublishedSession;
	preload?: boolean;
}) {
	const artwork = session.heroImage || session.coverImage;
	if (!artwork) {
		return (
			<div className={styles.artworkPlaceholder} aria-hidden="true">
				<span>TDA</span>
			</div>
		);
	}

	return (
		<Image
			className={styles.sessionArtwork}
			src={artwork}
			alt=""
			fill
			preload={preload}
			sizes={
				preload
					? "(max-width: 900px) calc(100vw - 40px), (max-width: 1920px) 48vw, 1080px"
					: "(max-width: 700px) calc(100vw - 40px), (max-width: 1200px) 45vw, 460px"
			}
		/>
	);
}

function ArchivePreview({ unavailable = false }: { unavailable?: boolean }) {
	return (
		<div className={styles.archivePreview} role={unavailable ? "status" : undefined}>
			<div className={styles.archiveMark} aria-hidden="true">
				TDA
			</div>
			<div>
				<Eyebrow>{unavailable ? "Arquivo indisponível" : "Arquivo da campanha"}</Eyebrow>
				<h2>
					{unavailable
						? "Não conseguimos abrir a última memória agora."
						: "A próxima memória começa aqui."}
				</h2>
				<p>
					{unavailable
						? "As histórias continuam guardadas. Tente novamente em instantes para carregar a sessão mais recente."
						: "Assim que uma sessão for publicada, sua arte e sua história passam a ocupar este espaço."}
				</p>
			</div>
		</div>
	);
}

export default async function Home() {
	let sessions: Awaited<ReturnType<typeof listPublishedSessions>> | undefined;
	try {
		sessions = await listPublishedSessions();
	} catch {
		sessions = undefined;
	}

	const latest = sessions?.[0];
	const recent = sessions?.slice(latest ? 1 : 0, latest ? 5 : 4) ?? [];
	const latestDate = latest ? formatSessionDate(latest.date) : "";

	return (
		<div className={styles.home}>
			<section className={styles.hero} aria-labelledby="home-title">
				<div className={styles.heroIntro}>
					<Eyebrow>Nossa campanha</Eyebrow>
					<DisplayTitle className={styles.heroTitle} id="home-title">
						Rolamos dados.
						<br />
						Guardamos os dados.
					</DisplayTitle>
					<BodyCopy className={styles.heroBody}>
						Um arquivo vivo das sessões, decisões e memórias que construímos
						juntos ao redor da mesa.
					</BodyCopy>
					<div className={styles.heroActions}>
						<ActionLink href="/sessoes" variant="primary">
							Explorar as sessões <span aria-hidden="true">→</span>
						</ActionLink>
						{sessions?.length ? (
							<p className={styles.archiveCount}>
								<strong>{sessions.length}</strong>
								<span>
									{sessions.length === 1 ? "memória publicada" : "memórias publicadas"}
								</span>
							</p>
						) : null}
					</div>
				</div>

				<div className={styles.heroFeature}>
					{latest ? (
						<article className={styles.latestCard}>
							<Link
								className={styles.latestMedia}
								href={`/sessoes/${encodeURIComponent(latest.id)}`}
								aria-label={`Abrir ${latest.title}`}
							>
								<SessionArtwork session={latest} preload />
								<div className={styles.latestMediaShade} aria-hidden="true" />
								<span className={styles.latestBadge}>Última sessão</span>
							</Link>
							<div className={styles.latestBody}>
								<div className={styles.latestMeta}>
									<span>{latest.arc || "Memória da campanha"}</span>
									{latestDate ? (
										<time dateTime={latest.date}>{latestDate}</time>
									) : null}
								</div>
								<h2 className={styles.latestTitle}>
									<Link href={`/sessoes/${encodeURIComponent(latest.id)}`}>
										{latest.title}
									</Link>
								</h2>
								<p className={styles.latestSummary}>
									{latest.summary ||
										"Uma nova memória da campanha já está pronta para ser revisitada."}
								</p>
								<Link
									className={styles.latestLink}
									href={`/sessoes/${encodeURIComponent(latest.id)}`}
								>
									Abrir sessão <span aria-hidden="true">→</span>
								</Link>
							</div>
						</article>
					) : (
						<ArchivePreview unavailable={sessions === undefined} />
					)}
				</div>
			</section>

			<section className={styles.memories} aria-labelledby="memories-title">
				<div className={styles.sectionHeading}>
					<div>
						<Eyebrow>O que vivemos juntos</Eyebrow>
						<SectionTitle className={styles.sectionTitle} id="memories-title">
							Memórias recentes
						</SectionTitle>
					</div>
					<Link className={styles.sectionLink} href="/sessoes">
						Ver todas as sessões <span aria-hidden="true">→</span>
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
				) : recent.length ? (
					<div className={styles.memoryGrid}>
						{recent.map((session) => {
							const href = `/sessoes/${encodeURIComponent(session.id)}`;
							const date = formatSessionDate(session.date);
							return (
								<article className={styles.memoryCard} key={session.id}>
									<Link className={styles.memoryCardLink} href={href}>
										<div className={styles.memoryMedia}>
											<SessionArtwork session={session} />
											<div className={styles.memoryShade} aria-hidden="true" />
										</div>
										<div className={styles.memoryBody}>
											<div className={styles.memoryMeta}>
												<span>{session.arc || "Memória da campanha"}</span>
												{date ? <time dateTime={session.date}>{date}</time> : null}
											</div>
											<h3>{session.title}</h3>
											<p>
												{session.summary ||
													"O resumo desta sessão ainda não está disponível."}
											</p>
											<span className={styles.memoryRead}>
												Revisitar memória <span aria-hidden="true">→</span>
											</span>
										</div>
									</Link>
								</article>
							);
						})}
					</div>
				) : latest ? (
					<p className={styles.state}>
						A primeira memória já está em destaque. As próximas aparecem aqui.
					</p>
				) : (
					<p className={styles.state}>Nenhuma sessão publicada ainda.</p>
				)}
			</section>
		</div>
	);
}
