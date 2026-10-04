import type { Metadata } from "next";
import Form from "next/form";
import { notFound } from "next/navigation";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { PublicLink as Link } from "@/components/public-link";
import { FormSubmitButton, Select, StatusPill } from "@/components/ui";
import { requireCampaignCapability } from "@/features/auth/server";
import { canManageCampaignRegistry } from "@/features/campaigns/policy";
import { editSessionDetailHref, editSessionLibraryHref, readEditableSessionCampaigns } from "@/features/campaigns/sessions";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import {
	filterAndSortSessionLibrary,
	sessionEditorialLabel,
	sessionEditorialTone,
	sessionLibraryArcs,
	type SessionLibraryFilters,
} from "@/features/edit/sessions/library";
import { listEditSessionLibrary } from "@/features/edit/sessions/repository";
import { SessionLibraryThumbnail } from "@/features/edit/sessions/session-library-thumbnail";
import { SessionCampaignSwitcher } from "@/features/edit/sessions/session-campaign-switcher";
import styles from "@/features/edit/workbench.module.css";
import { formatSessionDate } from "@/features/sessions/model";

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

function ErrorState({ retryHref }: { retryHref: string }) {
	return (
		<section
			className={styles.locked}
			data-layout-family="workspace"
			data-layout-role="editorial"
		>
			<OperationalPageHeader
				eyebrow="Edit · Sessões"
				title="Sessões indisponíveis"
			/>
			<p className={styles.muted}>
				Não foi possível consultar a biblioteca editorial agora. Tente novamente
				sem assumir que a lista está vazia.
			</p>
			<div className={styles.libraryActions}>
				<Link href={retryHref}>Tentar novamente</Link>
			</div>
		</section>
	);
}

export default async function EditSessionsPage({
	params,
	searchParams,
}: {
	params: Promise<{ campaignSlug: string }>;
	searchParams: SearchParams;
}) {
	const { campaignSlug } = await params;
	const returnTo = editSessionLibraryHref(campaignSlug);
	const accessContext = await requireCampaignCapability(
		EDIT_CAPABILITIES.transcriptRead,
		campaignSlug,
		returnTo,
	);
	const eligible = await readEditableSessionCampaigns(accessContext);
	if (!eligible.ok) return <ErrorState retryHref={returnTo} />;
	const campaign = eligible.campaigns.find((item) => item.technicalSlug === campaignSlug);
	if (!campaign) notFound();
	const rawSearchParams = await searchParams;
	const filters = parseFilters(rawSearchParams);
	const canManageCampaigns = canManageCampaignRegistry(accessContext);
	const preservedQuery = new URLSearchParams();
	for (const [key, value] of Object.entries(rawSearchParams)) {
		const normalized = Array.isArray(value) ? value[0] : value;
		if (normalized) preservedQuery.set(key, normalized);
	}
	const returnWithIntent = preservedQuery.size
		? `${returnTo}?${preservedQuery.toString()}`
		: returnTo;
	const manageHref = canManageCampaigns
		? `/edit/campanhas?next=${encodeURIComponent(returnWithIntent)}`
		: undefined;

	let sessions: Awaited<ReturnType<typeof listEditSessionLibrary>>;
	try {
		sessions = await listEditSessionLibrary(campaignSlug);
	} catch {
		return <ErrorState retryHref={returnTo} />;
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
		<section
			className={[styles.shell, styles.libraryShell].join(" ")}
			data-layout-family="workspace"
			data-layout-role="expansive"
		>
			<OperationalPageHeader
				eyebrow="Edit · Sessões"
				title="Biblioteca editorial"
				meta={
					<div className={styles.libraryHeaderMeta} role="status" aria-live="polite">
						<span>
							{campaign.name}
							{campaign.lifecycle === "archived" ? " · arquivada" : ""}
						</span>
						<span>
							<strong>{visible.length.toLocaleString("pt-BR")}</strong> de{" "}
							{sessions.length.toLocaleString("pt-BR")} sessões
						</span>
					</div>
				}
			/>

			<div className={styles.libraryFilters}>
				<SessionCampaignSwitcher
					className={styles.control}
					options={eligible.campaigns.map((item) => ({
						key: item.technicalSlug,
						name: item.name,
						href: editSessionLibraryHref(item.technicalSlug),
						current: item.technicalSlug === campaignSlug,
						lifecycle: item.lifecycle,
					}))}
					manageHref={manageHref}
				/>
			</div>

			<Form action={returnTo} className={styles.libraryFilters}>
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
					<Select
						name="estado"
						defaultValue={filters.state}
						options={[
							{ value: "all", label: "Todos os estados" },
							{ value: "prepared", label: "Com transcrição preparada" },
							{ value: "unprepared", label: "Sem transcrição preparada" },
							{ value: "ready_for_review", label: "Aguardando edição" },
							{ value: "reviewing", label: "Em edição" },
							{ value: "approved", label: "Pronto para publicar" },
							{ value: "published", label: "Publicado" },
							{ value: "archived", label: "Arquivado" },
						]}
						ariaLabel="Estado"
						compact
					/>
				</label>
				<label>
					<span>Publicação</span>
					<Select
						name="publicacao"
						defaultValue={filters.publication}
						options={[
							{ value: "all", label: "Todas" },
							{ value: "published", label: "Publicadas no site" },
							{ value: "unpublished", label: "Ainda não publicadas" },
						]}
						ariaLabel="Publicação"
						compact
					/>
				</label>
				<label>
					<span>Arco</span>
					<Select
						name="arco"
						defaultValue={filters.arc}
						options={[
							{ value: "all", label: "Todos os arcos" },
							...arcs.map((arc) => ({ value: arc, label: arc })),
						]}
						ariaLabel="Arco"
						compact
					/>
				</label>
				<label>
					<span>Ordenar</span>
					<Select
						name="ordem"
						defaultValue={filters.sort}
						options={[
							{ value: "date-desc", label: "Sessões mais recentes" },
							{ value: "date-asc", label: "Sessões mais antigas" },
							{ value: "title", label: "Título" },
						]}
						ariaLabel="Ordenar"
						compact
					/>
				</label>
				<div className={styles.libraryFilterActions}>
					<FormSubmitButton
						className={styles.librarySubmit}
						pendingLabel="Aplicando…"
					>
						Aplicar
					</FormSubmitButton>
					{hasFilters ? <Link href={returnTo}>Limpar filtros</Link> : null}
				</div>
			</Form>

			<details className={styles.libraryGuidance}>
				<summary>Sobre esta biblioteca</summary>
				<p>
					Área privada para continuar o trabalho das sessões preparadas. O
					estado <strong>Publicado</strong> se refere à sessão no site; a
					transcrição continua privada no Edit.
				</p>
			</details>

			{sessions.length === 0 ? (
				<div className={styles.empty}>
					<h2>Nenhuma sessão preparada ainda</h2>
					<p>
						Conclua uma transcrição em Resultados e use “Preparar sessão” para
						trazê-la à área privada do Edit.
					</p>
					<Link href={`/edit/${encodeURIComponent(campaignSlug)}/processamento`}>Ir para Processamento</Link>
				</div>
			) : visible.length === 0 ? (
				<div className={styles.empty}>
					<h2>Nenhuma sessão corresponde aos filtros</h2>
					<p>Os filtros continuam ativos; limpe-os para voltar à biblioteca completa.</p>
					<Link href={returnTo}>Limpar filtros</Link>
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
								href={editSessionDetailHref(campaignSlug, session.sourceSessionId)}
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
