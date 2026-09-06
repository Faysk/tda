import { listPublishedSessions } from "@/features/sessions/repository";
import { SessionList } from "@/components/session-list";
export const dynamic = "force-dynamic";
export const metadata = { title: "Sessões" };
export default async function Sessions() {
	let sessions: Awaited<ReturnType<typeof listPublishedSessions>> | undefined;
	try {
		sessions = await listPublishedSessions();
	} catch {
		sessions = undefined;
	}
	return (
		<section className="page-section">
			<span className="eyebrow">Arquivo da campanha</span>
			<h1>As histórias até aqui</h1>
			{sessions === undefined ? (
				<p role="status">
					Não foi possível carregar as sessões. Tente novamente em instantes.
				</p>
			) : sessions === null ? (
				<p>Estamos preparando o arquivo da campanha.</p>
			) : sessions.length ? (
				<SessionList sessions={sessions} />
			) : (
				<p>Nenhuma sessão publicada ainda.</p>
			)}
		</section>
	);
}
