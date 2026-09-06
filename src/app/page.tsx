import Image from "next/image";
import Link from "next/link";
import { SessionList } from "@/components/session-list";
import { listPublishedSessions } from "@/features/sessions/repository";

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
		<>
			<section className={`hero${heroImage ? " hero--with-art" : ""}`}>
				{heroImage ? (
					<>
						<Image
							className="hero-art"
							src={heroImage}
							alt=""
							fill
							priority
							sizes="(max-width: 1200px) 100vw, 1200px"
						/>
						<div className="hero-overlay" aria-hidden="true" />
					</>
				) : null}
				<div className="hero-copy">
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
					<div className="hero-actions">
						<Link className="button" href="/sessoes">
							Explorar as sessões <span aria-hidden="true">↗</span>
						</Link>
						{latest ? (
							<Link
								className="hero-latest"
								href={`/sessoes/${encodeURIComponent(latest.id)}`}
							>
								<span>Última memória</span>
								<strong>{latest.title}</strong>
							</Link>
						) : null}
					</div>
				</div>
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
					<SessionList sessions={sessions.slice(0, 4)} featuredFirst />
				) : (
					<p>Nenhuma sessão publicada ainda.</p>
				)}
			</section>
		</>
	);
}
