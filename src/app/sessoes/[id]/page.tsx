import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StoryMarkdown } from "@/components/story-markdown";
import { DisplayTitle, Eyebrow } from "@/components/ui";
import { formatSessionDate } from "@/features/sessions/model";
import {
	findPublishedSession,
	listPublishedSessions,
} from "@/features/sessions/repository";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type SessionParams = { params: Promise<{ id: string }> };

function descriptionFrom(summary: string) {
	return summary
		.replace(/[#>*_`~-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 180);
}

export async function generateMetadata({ params }: SessionParams): Promise<Metadata> {
	const { id } = await params;
	const session = await findPublishedSession(id);
	if (!session) return { title: "Sessão não encontrada" };
	const description =
		descriptionFrom(session.summary) ||
		"Uma das histórias guardadas no arquivo da nossa campanha.";
	const image = session.heroImage || session.coverImage;

	return {
		title: session.title,
		description,
		openGraph: {
			title: session.title,
			description,
			type: "article",
			...(image ? { images: [{ url: image }] } : {}),
		},
		twitter: {
			card: image ? "summary_large_image" : "summary",
			title: session.title,
			description,
			...(image ? { images: [image] } : {}),
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
