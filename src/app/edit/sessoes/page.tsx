import type { Metadata } from "next";
import { PublicLink as Link } from "@/components/public-link";
import { StatusPill } from "@/components/ui";
import { requireCapability } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import {
	filterAndSortSessionLibrary,
	sessionEditorialLabel,
	sessionEditorialTone,
	sessionLibraryArcs,
	type SessionLibraryFilters,
} from "@/features/edit/sessions/library";
import { listEditSessionLibrary } from "@/features/edit/sessions/repository";
import styles from "@/features/edit/workbench.module.css";
import { CAMPAIGN_SLUG, formatSessionDate } from "@/features/sessions/model";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
	title: "Sessões · Edit",
	description: "Biblioteca editorial privada de sessões.",
	robots: { index: false, follow: false },
};

type SearchParams = Promise<{
	q?: string | string[];
	estado?: string | string[];
	publicacao?: string | string[];
	arco?: string | string[];
	ordem?: string | string[];
}>;

function first(value: string | string[] | undefined): string {
	return Array.isArray(value) ? value[0] || "" : value || "";
}

function parseFilters(params: Awaited<SearchParams>): SessionLibraryFilters {
	const sort = first(params.ordem);
	return {
		query: first(params.q).slice(0, 160),
		state: first(params.estado) || "all",
		publication: first(params.publicacao) || "all",
		arc: first(params.arco).slice(0, 300) || "all",
		sort:
			sort === "date-asc" || sort === "title" || sort === "date-desc"
				? sort
				: "date-desc",
	};
}

function ErrorState() {
	return (
		<section className={styles.locked}>
			<div className={styles.muted}>TDA / EDIT / SESSÕES</div>
			<h1>Sessões indisponíveis</h1>
			<p className={styles.muted}>
				Não foi possível consultar a biblioteca editorial agora. Tente novamente
				sem assumir que a lista está vazia.
			</p>
			<div className={styles.libraryActions}>
				<Link href="/edit/sessoes">Tentar novamente</Link>
				<Link href="/edit">← Voltar ao Edit</Link>
			</div>
		</section>
	);
}

export default async function EditSessionsPage({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	await requireCapability(EDIT_CAPABILITIES.transcriptRead, "/edit/sessoes");
	const filters = parseFilters(await searchParams);

	let sessions: Awaited<ReturnType<typeof listEditSessionLibrary>>;
	try {
		sessions = await listEditSessionLibrary(CAMPAIGN_SLUG);
	} catch {
		return <ErrorState />;
	}

	const arcs = sessionLibraryArcs(sessions);
	const visible = filterAndSortSessionLibrary(sessions, filters);
	const hasFilters =
		Boolean(filters.query) ||
		filters.state !== "all" ||
		filters.publication !== "all" ||
		filters.arc !== "all" ||
		filters.sort !== "date-desc";

	return (
		<section className={styles.shell}>
			<header className={styles.pageHeader}>
				<div>
					<Link className={styles.muted} href="/edit">
						← Visão geral do Edit
					</Link>
					<p className={styles.libraryEyebrow}>TDA / EDIT / SESSÕES</p>
					<h1 className={styles.pageTitle}>Biblioteca editorial</h1>
					<p className={styles.libraryIntro}>
						Área privada para continuar o trabalho das sessões preparadas. O
						estado <strong>Publicado</strong> se refere à sessão no site; a
						transcrição continua privada no Edit.
					</p>
				</div>
				<div className={styles.libraryCount} role="status" aria-live="polite">
					<strong>{visible.length.toLocaleString("pt-BR")}</strong> de{" "}
					{sessions.length.toLocaleString("pt-BR")} sessões
				</div>
			</header>

			<form className={styles.libraryFilters} method="get" role="search">
				<label className={styles.librarySearch}>
					<span>Buscar sessão</span>
					<input
						className={styles.search}
						defaultValue={filters.query}
						maxLength={160}
						name="q"
						placeholder="Título, arco ou origem"
						type="search"
					/>
				</label>
				<label>
					<span>Estado</span>
					<select className={styles.control} defaultValue={filters.state} name="estado">
						<option value="all">Todos os estados</option>
						<option value="prepared">Com transcrição preparada</option>
						<option value="unprepared">Sem transcrição preparada</option>
						<option value="ready_for_review">Aguardando edição</option>
						<option value="reviewing">Em edição</option>
						<option value="approved">Pronto para publicar</option>
						<option value="published">Publicado</option>
						<option value="archived">Arquivado</option>
					</select>
				</label>
				<label>
					<span>Publicação</span>
					<select
						className={styles.control}
						defaultValue={filters.publication}
						name="publicacao"
					>
						<option value="all">Todas</option>
						<option value="published">Publicadas no site</option>
						<option value="unpublished">Ainda não publicadas</option>
					</select>
				</label>
				<label>
					<span>Arco</span>
					<select className={styles.control} defaultValue={filters.arc} name="arco">
						<option value="all">Todos os arcos</option>
						{arcs.map((arc) => (
							<option key={arc} value={arc}>
								{arc}
							</option>
						))}
					</select>
				</label>
				<label>
					<span>Ordenar</span>
					<select className={styles.control} defaultValue={filters.sort} name="ordem">
						<option value="date-desc">Sessões mais recentes</option>
						<option value="date-asc">Sessões mais antigas</option>
						<option value="title">Título</option>
					</select>
				</label>
				<div className={styles.libraryFilterActions}>
					<button className={styles.librarySubmit} type="submit">
						Aplicar
					</button>
					{hasFilters ? <Link href="/edit/sessoes">Limpar filtros</Link> : null}
				</div>
			</form>

			{sessions.length === 0 ? (
				<div className={styles.empty}>
					<h2>Nenhuma sessão preparada ainda</h2>
					<p>
						Conclua uma transcrição em Resultados e use “Preparar sessão” para
						trazê-la à área privada do Edit.
					</p>
					<Link href="/edit/processamento">Ir para Processamento</Link>
				</div>
			) : visible.length === 0 ? (
				<div className={styles.empty}>
					<h2>Nenhuma sessão corresponde aos filtros</h2>
					<p>Os filtros continuam ativos; limpe-os para voltar à biblioteca completa.</p>
					<Link href="/edit/sessoes">Limpar filtros</Link>
				</div>
			) : (
				<div className={styles.libraryList}>
					{visible.map((session) => (
						<article className={styles.libraryRow} key={session.id}>
							<div className={styles.libraryPrimary}>
								<div className={styles.sessionMeta}>
									<StatusPill tone={sessionEditorialTone(session)}>
										{sessionEditorialLabel(session)}
									</StatusPill>
									{session.arc ? (
										<StatusPill tone="accent">{session.arc}</StatusPill>
									) : null}
								</div>
								<h2 className={styles.sessionTitle}>{session.title}</h2>
								<div className={styles.librarySecondary}>
									<span>
										{session.sessionDate
											? formatSessionDate(session.sessionDate)
											: "Data não informada"}
									</span>
									<span>
										{session.transcriptPrepared
											? "Transcrição privada preparada"
											: "Aguardando handoff da transcrição"}
									</span>
									<span className={styles.sessionId}>{session.sourceSessionId}</span>
								</div>
							</div>
							<Link
								className={styles.libraryOpen}
								href={`/edit/sessoes/${encodeURIComponent(session.sourceSessionId)}`}
							>
								Abrir sessão
							</Link>
						</article>
					))}
				</div>
			)}
		</section>
	);
}
