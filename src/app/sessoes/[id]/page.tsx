import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import { SessionShareActions } from "@/components/session-share-actions";
import { StoryMarkdown } from "@/components/story-markdown";
import { DisplayTitle, Eyebrow } from "@/components/ui";
import { formatSessionDate } from "@/features/sessions/model";
import {
	findPublishedSession,
	listPublishedSessions,
} from "@/features/sessions/repository";
import { sessionShareDescription } from "@/features/sessions/share";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type SessionParams = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: SessionParams): Promise<Metadata> {
	const { id } = await params;
	const session = await findPublishedSession(id);
	if (!session) return { title: "Sessão não encontrada" };
	const description = sessionShareDescription(session.summary, session.title);
	const image = session.heroImage || session.coverImage;
	const imageAlt = `Arte da sessão ${session.title}`;

	return {
		title: session.title,
		description,
		alternates: {
			canonical: `/sessoes/${encodeURIComponent(session.id)}`,
		},
		openGraph: {
			title: session.title,
			description,
			type: "article",
			locale: "pt_BR",
			siteName: "TDA — Tem Dado Aqui",
			...(image ? { images: [{ url: image, alt: imageAlt }] } : {}),
		},
		twitter: {
			card: image ? "summary_large_image" : "summary",
			title: session.title,
			description,
			...(image ? { images: [{ url: image, alt: imageAlt }] } : {}),
		},
	};
}

export default async function Session({ params }: SessionParams) {
	const { id } = await params;
	const session = await findPublishedSession(id);
	if (!session) notFound();

	let archive: Awaited<ReturnType<typeof listPublishedSessions>> = null;
	try {
		archive = await listPublishedSessions();
	} catch {
		archive = null;
	}
	const currentIndex = archive?.findIndex((item) => item.id === session.id) ?? -1;
	const previous =
		archive && currentIndex >= 0 ? archive[currentIndex + 1] : undefined;
	const next = archive && currentIndex > 0 ? archive[currentIndex - 1] : undefined;
	const story =
		session.fullSummary || session.summary || "Resumo ainda não disponível.";
	const image = session.heroImage || session.coverImage;
	const date = formatSessionDate(session.date);
	const shareDescription = sessionShareDescription(session.summary, session.title);

	return (
		<article>
			<header className={`${styles.hero}${image ? ` ${styles.heroWithArt}` : ""}`}>
				{image ? (
					<>
						<Image
							className={styles.art}
							src={image}
							alt=""
							fill
							preload
							sizes="100vw"
						/>
						<div className={styles.overlay} aria-hidden="true" />
					</>
				) : null}
				<div className={styles.content}>
					<Link className={styles.back} href="/sessoes">
						← Todas as sessões
					</Link>
					<Eyebrow className={styles.eyebrow}>
						{session.arc || "Memória da campanha"}
					</Eyebrow>
					<DisplayTitle className={styles.title}>{session.title}</DisplayTitle>
					{date ? (
						<time className={styles.date} dateTime={session.date}>
							{date}
						</time>
					) : null}
				</div>
			</header>

			<div className={styles.body}>
				<SessionShareActions
					title={session.title}
					description={shareDescription}
				/>
				<StoryMarkdown source={story} title={session.title} />
				{previous || next ? (
					<nav className={styles.pagination} aria-label="Navegação entre sessões">
						{previous ? (
							<Link
								className={styles.link}
								href={`/sessoes/${encodeURIComponent(previous.id)}`}
							>
								<span className={styles.label}>← Sessão anterior</span>
								<strong className={styles.linkTitle}>{previous.title}</strong>
							</Link>
						) : (
							<span aria-hidden="true" />
						)}
						{next ? (
							<Link
								className={`${styles.link} ${styles.next}`}
								href={`/sessoes/${encodeURIComponent(next.id)}`}
							>
								<span className={styles.label}>Próxima sessão →</span>
								<strong className={styles.linkTitle}>{next.title}</strong>
							</Link>
						) : null}
					</nav>
				) : null}
			</div>
		</article>
	);
}
