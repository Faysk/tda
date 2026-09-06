import Image from "next/image";
import Link from "next/link";
import {
	formatSessionDate,
	type PublishedSession,
} from "@/features/sessions/model";

export function SessionList({
	sessions,
	featuredFirst = false,
}: {
	sessions: readonly PublishedSession[];
	featuredFirst?: boolean;
}) {
	return (
		<div className={`session-grid${featuredFirst ? " session-grid--featured" : ""}`}>
			{sessions.map((session, index) => {
				const href = `/sessoes/${encodeURIComponent(session.id)}`;
				const date = formatSessionDate(session.date);
				const featured = featuredFirst && index === 0;
				return (
					<article
						className={`session-card${featured ? " session-card--featured" : ""}`}
						key={session.id}
					>
						<div className="session-card-media" aria-hidden="true">
							{session.coverImage ? (
								<Image
									className="session-card-image"
									src={session.coverImage}
									alt=""
									fill
									sizes={
										featured
											? "(max-width: 650px) 100vw, 56vw"
											: "(max-width: 650px) 100vw, 50vw"
									}
								/>
							) : (
								<span className="session-card-placeholder">TDA</span>
							)}
							<div className="session-card-vignette" />
						</div>
						<div className="session-card-body">
							<span className="eyebrow">
								{index === 0
									? "Última memória"
									: session.arc || "Memória da campanha"}
							</span>
							<h2>
								<Link href={href}>{session.title}</Link>
							</h2>
							{date ? (
								<time className="date" dateTime={session.date}>
									{date}
								</time>
							) : null}
							<p className="session-card-summary">
								{session.summary ||
									"O resumo desta sessão ainda não está disponível."}
							</p>
							<Link className="read-link" href={href}>
								Ler a história <span aria-hidden="true">→</span>
							</Link>
						</div>
					</article>
				);
			})}
		</div>
	);
}
