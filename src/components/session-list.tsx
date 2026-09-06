import Link from "next/link";
import type { PublishedSession } from "@/features/sessions/model";
export function SessionList({
	sessions,
}: {
	sessions: readonly PublishedSession[];
}) {
	return (
		<div className="session-grid">
			{sessions.map((session, index) => (
				<article className="session-card" key={session.id}>
					<span className="eyebrow">
						{index === 0
							? "Última memória"
							: session.arc || "Memória da campanha"}
					</span>
					<h2>
						<Link href={`/sessoes/${encodeURIComponent(session.id)}`}>
							{session.title}
						</Link>
					</h2>
					<p className="date">{session.date}</p>
					<p>
						{session.summary ||
							"O resumo desta sessão ainda não está disponível."}
					</p>
					<Link
						className="read-link"
						href={`/sessoes/${encodeURIComponent(session.id)}`}
					>
						Ler a história <span aria-hidden="true">→</span>
					</Link>
				</article>
			))}
		</div>
	);
}
