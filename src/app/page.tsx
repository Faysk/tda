import Link from "next/link";
import { listPublishedSessions } from "@/features/sessions/repository";
import { SessionList } from "@/components/session-list";
export const dynamic = "force-dynamic";
export default async function Home() {
	let sessions: Awaited<ReturnType<typeof listPublishedSessions>> | undefined;
	try {
		sessions = await listPublishedSessions();
	} catch {
		sessions = undefined;
	}
	return (
		<>
			<section className="hero">
				<span className="eyebrow">Nosso mundo, nossas histórias</span>
				<h1>
					Toda jornada
					<br />
					deixa uma história.
				</h1>
				<p>
					Entre encontros improváveis e decisões que mudam destinos, guardamos
					as memórias da nossa mesa.
				</p>
				<Link className="button" href="/sessoes">
					Explorar as sessões <span aria-hidden="true">↗</span>
				</Link>
				<div className="hero-rule" />
			</section>
			<section className="memories">
				<div className="section-heading">
					<div>
						<span className="eyebrow">O que vivemos juntos</span>
						<h2>Memórias da campanha</h2>
					</div>
					<Link href="/sessoes">Ver todas →</Link>
				</div>
				{sessions === undefined ? (
					<p role="status">
						Não foi possível carregar as memórias. Tente novamente em instantes.
					</p>
				) : sessions === null ? (
					<p>Estamos preparando o arquivo de histórias da campanha.</p>
				) : sessions.length ? (
					<SessionList sessions={sessions.slice(0, 4)} />
				) : (
					<p>Nenhuma sessão publicada ainda.</p>
				)}
			</section>
		</>
	);
}
