import Image from "next/image";
import { PublicLink as Link } from "@/components/public-link";
import {
	formatSessionDate,
	type PublishedSession,
} from "@/features/sessions/model";
import { Eyebrow } from "./ui";
import styles from "./session-list.module.css";

export function SessionList({
	sessions,
	featuredFirst = false,
}: {
	sessions: readonly PublishedSession[];
	featuredFirst?: boolean;
}) {
	return (
		<div className={styles.grid}>
			{sessions.map((session, index) => {
				const href = `/sessoes/${encodeURIComponent(session.id)}`;
				const date = formatSessionDate(session.date);
				const featured = featuredFirst && index === 0;

				return (
					<article
						className={`${styles.card}${featured ? ` ${styles.featured}` : ""}`}
						key={session.id}
					>
						<div className={styles.media} aria-hidden="true">
							{session.coverImage ? (
								<Image
									className={styles.image}
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
								<span className={styles.placeholder}>TDA</span>
							)}
							<div className={styles.vignette} />
						</div>

						<div className={styles.body}>
							<Eyebrow className={styles.eyebrow}>
								{index === 0
									? "Última memória"
									: session.arc || "Memória da campanha"}
							</Eyebrow>
							<h2 className={styles.title}>
								<Link className={styles.titleLink} href={href}>
									{session.title}
								</Link>
							</h2>
							{date ? (
								<time className={styles.date} dateTime={session.date}>
									{date}
								</time>
							) : null}
							<p className={styles.summary}>
								{session.summary ||
									"O resumo desta sessão ainda não está disponível."}
							</p>
							<Link className={styles.readLink} href={href}>
								Ler a história <span aria-hidden="true">→</span>
							</Link>
						</div>
					</article>
				);
			})}
		</div>
	);
}
