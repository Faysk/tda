import type { Metadata } from "next";
import { PublicLink as Link } from "@/components/public-link";
import { StatusPill } from "@/components/ui";
import { requireCapability } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import {
	listEditSessions,
	type EditSessionSummary,
} from "@/features/edit/sessions/repository";
import styles from "@/features/edit/workbench.module.css";
import { formatSessionDate } from "@/features/sessions/model";

export const metadata: Metadata = {
	title: "Sessões · Edit",
	description: "Biblioteca editorial privada de sessões preparadas.",
};

type PageProps = Readonly<{
	searchParams: Promise<{
		q?: string | string[];
		state?: string | string[];
		sort?: string | string[];
	}>;
}>;

function first(value: string | string[] | undefined): string {
	return Array.isArray(value) ? value[0] || "" : value || "";
}

function normalized(value: string) {
	return value.trim().toLocaleLowerCase("pt-BR");
}

function stateLabel(status: string) {
	switch (status) {
		case "ready_for_review":
			return "Aguardando edição";
		case "reviewing":
			return "Em edição";
		case "approved":
			return "Pronto para publicar";
		case "published":
			return "Publicado";
		case "archived":
			return "Arquivado";
		default:
			return status ? `Estado: ${status}` : "Estado desconhecido";
	}
}

function applyLibraryView(
	sessions: readonly EditSessionSummary[],
	query: string,
	state: string,
	sort: string,
) {
	const needle = normalized(query);
	const filtered = sessions.filter((session) => {
		if (state && session.status !== state) return false;
		if (!needle) return true;
		return [session.title, session.arc || "", session.sourceSessionId].some((value) =>
			normalized(value).includes(needle),
		);
	});

	return [...filtered].sort((left, right) => {
		if (sort === "title") return left.title.localeCompare(right.title, "pt-BR");
		const leftDate = left.sessionDate || "";
		const rightDate = right.sessionDate || "";
		if (sort === "oldest") {
			return leftDate.localeCompare(rightDate) || left.title.localeCompare(right.title, "pt-BR");
		}
		return rightDate.localeCompare(leftDate) || left.title.localeCompare(right.title, "pt-BR");
	});
}

export default async function EditSessionsPage({ searchParams }: PageProps) {
	await requireCapability(EDIT_CAPABILITIES.transcriptRead, "/edit/sessoes");

	let sessions: Awaited<ReturnType<typeof listEditSessions>>;
	try {
		sessions = await listEditSessions();
	} catch {
		return (
			<section className={styles.locked}>
				<div className={styles.muted}>TDA / EDIT / SESSÕES</div>
				<h1>Biblioteca indisponível</h1>
				<p className={styles.muted}>
					Não foi possível consultar as sessões preparadas agora. Tente novamente sem assumir que a biblioteca está vazia.
				</p>
				<Link href="/edit/sessoes">Tentar novamente</Link>
			</section>
		);
	}

	const params = await searchParams;
	const query = first(params.q).slice(0, 200);
	const state = first(params.state).slice(0, 80);
	const sort = first(params.sort);
	const visible = applyLibraryView(sessions, query, state, sort);

	return (
		<section className={styles.shell}>
			<header className={styles.pageHeader}>
				<div>
					<Link className={styles.muted} href="/edit">
						← Visão geral do Edit
					</Link>
					<h1 className={styles.pageTitle}>Sessões</h1>
					<p className={styles.muted}>
						Biblioteca editorial privada. Preparar ou editar uma sessão aqui não publica a transcrição no site.
					</p>
				</div>
				<div className={styles.muted} role="status">
					{visible.length} de {sessions.length} sessões preparadas
				</div>
			</header>

			<form className={styles.libraryFilters} method="get">
				<label className={styles.fieldLabel}>
					Buscar
					<input
						className={styles.search}
						defaultValue={query}
						name="q"
						placeholder="Título, arco ou origem"
						type="search"
					/>
				</label>
				<label className={styles.fieldLabel}>
					Estado
					<select className={styles.control} defaultValue={state} name="state">
						<option value="">Todos</option>
						<option value="ready_for_review">Aguardando edição</option>
						<option value="reviewing">Em edição</option>
						<option value="approved">Pronto para publicar</option>
						<option value="published">Publicado</option>
						<option value="archived">Arquivado</option>
					</select>
				</label>
				<label className={styles.fieldLabel}>
					Ordenar
					<select className={styles.control} defaultValue={sort} name="sort">
						<option value="">Data da sessão · recentes</option>
						<option value="oldest">Data da sessão · antigas</option>
						<option value="title">Título</option>
					</select>
				</label>
				<div className={styles.filterActions}>
					<button className={styles.filterButton} type="submit">Aplicar</button>
					<Link href="/edit/sessoes">Limpar</Link>
				</div>
			</form>

			{sessions.length === 0 ? (
				<div className={styles.empty}>
					<p>Nenhuma sessão foi preparada para edição ainda.</p>
					<p>
						Conclua uma transcrição em Resultados e use <strong>Preparar sessão</strong>.
					</p>
					<Link href="/edit/processamento">Ir para Processamento</Link>
				</div>
			) : visible.length === 0 ? (
				<div className={styles.empty}>
					<p>Nenhuma sessão corresponde aos filtros atuais.</p>
					<Link href="/edit/sessoes">Limpar filtros</Link>
				</div>
			) : (
				<div className={styles.sessionList}>
					{visible.map((session) => (
						<Link
							className={styles.sessionRow}
							href={`/edit/sessoes/${encodeURIComponent(session.sourceSessionId)}`}
							key={session.id}
						>
							<div className={styles.sessionRowMain}>
								<div className={styles.sessionMeta}>
									<StatusPill tone={session.status === "published" ? "success" : "neutral"}>
										{stateLabel(session.status)}
									</StatusPill>
									{session.arc ? <StatusPill tone="accent">{session.arc}</StatusPill> : null}
								</div>
								<h2 className={styles.sessionTitle}>{session.title}</h2>
								<div className={styles.muted}>
									{session.sessionDate ? formatSessionDate(session.sessionDate) : "Sem data"}
									{" · "}
									{session.status === "published" ? "Publicado no site" : "Privado no Edit"}
								</div>
							</div>
							<div className={styles.sessionRowAside}>
								<span className={styles.muted}>Transcrição preparada</span>
								<span aria-hidden="true">Abrir →</span>
							</div>
						</Link>
					))}
				</div>
			)}
		</section>
	);
}
