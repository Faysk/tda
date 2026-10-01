import type { Metadata } from "next";
import Form from "next/form";
import { redirect } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import { FormSubmitButton, StatusPill } from "@/components/ui";
import { currentAccess } from "@/features/auth/server";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import {
	editSessionDetailHref,
	editSessionLibraryHref,
	readEligibleEditSessionCampaigns,
} from "@/features/edit/sessions/session-campaigns";
import { SessionCampaignSwitcher } from "@/features/edit/sessions/session-campaign-switcher";
import {
	filterAndSortSessionLibrary,
	sessionEditorialLabel,
	sessionEditorialTone,
	sessionLibraryArcs,
	type SessionLibraryFilters,
} from "@/features/edit/sessions/library";
import { listEditSessionLibrary } from "@/features/edit/sessions/repository";
import { SessionLibraryThumbnail } from "@/features/edit/sessions/session-library-thumbnail";
import styles from "@/features/edit/workbench.module.css";
import { formatSessionDate } from "@/features/sessions/model";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
	title: "Sessões · Edit",
	description: "Biblioteca editorial privada de sessões por campanha.",
	robots: { index: false, follow: false },
};

type SearchParams = Promise<{
	q?: string | string[];
	estado?: string | string[];
	publicacao?: string | string[];
	arco?: string | string[];
	ordem?: string | string[];
}>;

type Props = Readonly<{
	params: Promise<{ campaignSlug: string }>;
	searchParams: SearchParams;
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

function ErrorState({ href }: Readonly<{ href: string }>) {
	return (
		<section className={styles.locked}>
			<div className={styles.muted}>TDA / EDIT / SESSÕES</div>
			<h1>Sessões indisponíveis</h1>
			<p className={styles.muted}>
				Não foi possível consultar a biblioteca editorial agora. Tente novamente
				sem assumir que a lista está vazia.
			</p>
			<div className={styles.libraryActions}>
				<Link href={href}>Tentar novamente</Link>
			</div>
		</section>
	);
}

export default async function CampaignEditSessionsPage({
	params,
	searchParams,
}: Props) {
	const [{ campaignSlug }, query, access] = await Promise.all([
		params,
		searchParams,
		currentAccess(),
	]);
	const next = encodeURIComponent(`/edit/${campaignSlug}/sessoes`);
	if (access.state === "anonymous") redirect(`/entrar?next=${next}`);
	if (access.state === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId) redirect("/conta?acesso=negado");

	const authorization = authorizeCampaignCapability(
		access.context,
		EDIT_CAPABILITIES.transcriptRead,
		campaignSlug,
	);
	if (!authorization.ok) redirect("/conta?acesso=negado");

	const eligible = await readEligibleEditSessionCampaigns(
		access.context,
		EDIT_CAPABILITIES.transcriptRead,
	);
	if (!eligible.ok) {
		return <ErrorState href={editSessionLibraryHref(campaignSlug)} />;
	}
	const campaign =
		eligible.campaigns.find(
			(option) => option.technicalSlug === campaignSlug,
		) ?? null;
	if (!campaign) redirect("/conta?acesso=negado");

	const filters = parseFilters(query);
	let sessions: Awaited<ReturnType<typeof listEditSessionLibrary>>;
	try {
		sessions = await listEditSessionLibrary(campaignSlug);
	} catch {
		return <ErrorState href={editSessionLibraryHref(campaignSlug)} />;
	}

	const arcs = sessionLibraryArcs(sessions);
	const visible = filterAndSortSessionLibrary(sessions, filters);
	const hasFilters =
		Boolean(filters.query) ||
		filters.state !== "all" ||
		filters.publication !== "all" ||
		filters.arc !== "all" ||
		filters.sort !== "date-desc";
	const libraryHref = editSessionLibraryHref(campaignSlug);

	return (
		<section className={styles.shell}>
			<header className={styles.pageHeader}>
				<div>
					<p className={styles.libraryEyebrow}>TDA / EDIT / SESSÕES</p>
					<h1 className={[styles.pageTitle, styles.libraryTitle].join(" ")}>
						Biblioteca editorial
					</h1>
					<p className={styles.muted}>
						{campaign.name}
						{campaign.lifecycle === "archived" ? " · campanha arquivada" : ""}
					</p>
					<details className={styles.libraryGuidance}>
						<summary>Sobre esta biblioteca</summary>
						<p>
							Área privada para continuar o trabalho das sessões desta campanha.
							O estado <strong>Publicado</strong> se refere à sessão no site; a
							transcrição continua privada no Edit.
						</p>
					</details>
				</div>
				<div className={styles.libraryCount} role="status" aria-live="polite">
					<strong>{visible.length.toLocaleString("pt-BR")}</strong> de{" "}
					{sessions.length.toLocaleString("pt-BR")} sessões
				</div>
			</header>

			<div className={styles.libraryFilters}>
				<SessionCampaignSwitcher
					campaigns={eligible.campaigns}
					currentCampaignSlug={campaignSlug}
				/>
			</div>

			<Form action={libraryHref} className={styles.libraryFilters}>
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
					<FormSubmitButton
						className={styles.librarySubmit}
						pendingLabel="Aplicando…"
					>
						Aplicar
					</FormSubmitButton>
					{hasFilters ? <Link href={libraryHref}>Limpar filtros</Link> : null}
				</div>
			</Form>

			{sessions.length === 0 ? (
				<div className={styles.empty}>
					<h2>Nenhuma sessão preparada ainda</h2>
					<p>
						Conclua uma transcrição em Resultados e use “Preparar sessão” para
						trazê-la à área privada do Edit desta campanha.
					</p>
					<Link
						href={`/edit/processamento?campanha=${encodeURIComponent(campaignSlug)}`}
					>
						Ir para Processamento
					</Link>
				</div>
			) : visible.length === 0 ? (
				<div className={styles.empty}>
					<h2>Nenhuma sessão corresponde aos filtros</h2>
					<p>
						Os filtros continuam ativos; limpe-os para voltar à biblioteca
						completa desta campanha.
					</p>
					<Link href={libraryHref}>Limpar filtros</Link>
				</div>
			) : (
				<div className={styles.libraryList}>
					{visible.map((session) => (
						<article className={styles.libraryRow} key={session.id}>
							<SessionLibraryThumbnail
								src={session.thumbnail?.src ?? null}
								privateSource={session.thumbnail?.kind === "private"}
							/>
							<div className={styles.libraryPrimary}>
								<h2 className={styles.sessionTitle}>{session.title}</h2>
								<div className={styles.sessionMeta}>
									<StatusPill tone={sessionEditorialTone(session)}>
										{sessionEditorialLabel(session)}
									</StatusPill>
									{session.arc ? (
										<StatusPill tone="accent">{session.arc}</StatusPill>
									) : null}
								</div>
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
									<details className={styles.libraryDetails}>
										<summary>Detalhes</summary>
										<span className={styles.sessionId}>{session.sourceSessionId}</span>
									</details>
								</div>
							</div>
							<Link
								className={styles.libraryOpen}
								href={editSessionDetailHref(
									campaignSlug,
									session.sourceSessionId,
								)}
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
