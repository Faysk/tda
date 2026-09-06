import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StoryMarkdown } from "@/components/story-markdown";
import { formatSessionDate } from "@/features/sessions/model";
import {
	findPublishedSession,
	listPublishedSessions,
} from "@/features/sessions/repository";

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
		<article className="story-page">
			<header className={`story-hero${image ? " story-hero--with-art" : ""}`}>
				{image ? (
					<>
						<Image
							className="story-hero-art"
							src={image}
							alt=""
							fill
							priority
							sizes="(max-width: 1200px) 100vw, 1200px"
						/>
						<div className="story-hero-overlay" aria-hidden="true" />
					</>
				) : null}
				<div className="story-hero-content">
					<Link className="story-back" href="/sessoes">
						← Todas as sessões
					</Link>
					<p className="eyebrow">{session.arc || "Memória da campanha"}</p>
					<h1>{session.title}</h1>
					{date ? (
						<time className="date" dateTime={session.date}>
							{date}
						</time>
					) : null}
				</div>
			</header>

			<div className="page-section story story-body">
				<StoryMarkdown source={story} title={session.title} />
				{previous || next ? (
					<nav className="story-pagination" aria-label="Navegação entre sessões">
						{previous ? (
							<Link
								className="story-pagination-link story-pagination-link--previous"
								href={`/sessoes/${encodeURIComponent(previous.id)}`}
							>
								<span>← Sessão anterior</span>
								<strong>{previous.title}</strong>
							</Link>
						) : (
							<span aria-hidden="true" />
						)}
						{next ? (
							<Link
								className="story-pagination-link story-pagination-link--next"
								href={`/sessoes/${encodeURIComponent(next.id)}`}
							>
								<span>Próxima sessão →</span>
								<strong>{next.title}</strong>
							</Link>
						) : null}
					</nav>
				) : null}
			</div>
		</article>
	);
}
