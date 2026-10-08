import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { FormSubmitButton, Select } from "@/components/ui";
import { currentAccess } from "@/features/auth/server";
import {
	readAuthorizedCampaignRoutes,
	resolveAuthorizedCampaignReference,
	type AuthorizedCampaignRoute,
} from "@/features/campaigns/authorized-routes";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { reviewCanonCandidateFormAction } from "@/features/edit/review/actions";
import { loadCanonReviewQueue } from "@/features/edit/review/server";
import { reviewQueueView } from "@/features/edit/review/queue-view";
import styles from "@/features/edit/review/review.module.css";

export const metadata: Metadata = {
	title: "Revisão narrativa · Edit",
	description: "Fila humana de revisão antes da entrada no cânone da campanha.",
	robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

type SearchParams = Promise<
	Readonly<{
		campanha?: string | string[];
		resultado?: string | string[];
		erro?: string | string[];
		busca?: string | string[];
		tipo?: string | string[];
		pagina?: string | string[];
	}>
>;

function first(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value;
}

function reviewHref(
	campaignSlug: string,
	feedback?: Readonly<{ resultado?: string; erro?: string }>,
) {
	const params = new URLSearchParams();
	if (feedback?.resultado) params.set("resultado", feedback.resultado);
	if (feedback?.erro) params.set("erro", feedback.erro);
	const query = params.toString();
	const path = `/edit/${encodeURIComponent(campaignSlug)}/revisao`;
	return query ? `${path}?${query}` : path;
}

function dateLabel(value: string | null) {
	if (!value) return "data não informada";
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return "data não informada";
	return new Intl.DateTimeFormat("pt-BR", {
		dateStyle: "medium",
		timeZone: "UTC",
	}).format(parsed);
}

function timeLabel(value: number | null) {
	if (value === null || value < 0) return "";
	const seconds = Math.floor(value / 1000);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	return [hours, minutes, rest]
		.map((part) => String(part).padStart(2, "0"))
		.join(":");
}

function feedbackMessage(
	result: string | undefined,
	error: string | undefined,
) {
	if (result === "approved")
		return "Candidato aprovado como cânone em revisão. Nenhuma publicação pública foi feita.";
	if (result === "rejected") return "Candidato rejeitado e retirado da fila.";
	if (result === "interpretation")
		return "Candidato classificado como interpretação, sem criação de cânone.";
	if (result === "possible_hook")
		return "Candidato classificado como possível gancho, sem criação de cânone.";
	if (result === "retcon_pending")
		return "Candidato marcado como retcon pendente para revisão posterior.";
	if (result === "private")
		return "Candidato classificado como privado e retirado da fila comum.";
	if (result === "unchanged")
		return "Esta decisão já estava registrada; nenhuma evidência foi duplicada.";
	if (error === "forbidden")
		return "Sua autoridade para esta decisão mudou. Atualize a campanha e a fila antes de tentar novamente.";
	if (error === "not_found")
		return "O candidato não está disponível nesta campanha.";
	if (error === "source_required")
		return "Aprovação bloqueada: o candidate não possui fonte física resolvível na mesma sessão.";
	if (error === "campaign_archived")
		return "Esta campanha foi arquivada. A fila pode ser consultada historicamente, mas novas decisões estão bloqueadas.";
	if (error === "invalid_state" || error === "conflict")
		return "O candidato mudou desde a abertura da página. Atualize a fila antes de decidir.";
	if (error === "invalid_payload")
		return "A decisão recebida não possui um contexto de campanha válido.";
	if (error)
		return "Não foi possível concluir a revisão. Nenhuma alteração parcial foi mantida.";
	return null;
}

function CampaignPicker({
	campaigns,
	selected,
	invalidSelection = false,
}: Readonly<{
	campaigns: readonly AuthorizedCampaignRoute[];
	selected?: string;
	invalidSelection?: boolean;
}>) {
	return (
		<div className={styles.campaignContext}>
			{invalidSelection ? (
				<p className={styles.campaignAlert} role="alert">
					A campanha pedida não está disponível neste contexto. Ela pode não
					existir, estar fora do seu acesso ou não estar mais disponível.
					Nenhuma campanha alternativa foi escolhida automaticamente.
				</p>
			) : null}
			<form className={styles.campaignPicker} method="get">
				<label htmlFor="review-campaign">
					<span>Campanha</span>
					<Select
						id="review-campaign"
						name="campanha"
						required
						defaultValue={selected ?? ""}
						options={[
							{ value: "", label: "Selecione…", disabled: true },
							...campaigns.map((campaign) => ({
								value: campaign.routeKey,
								label: `${campaign.name}${campaign.lifecycle === "archived" ? " (arquivada)" : ""}`,
							})),
						]}
						ariaLabel="Campanha"
					/>
				</label>
				<button type="submit">
					{selected ? "Trocar campanha" : "Abrir revisão"}
				</button>
			</form>
		</div>
	);
}

function QueuePagination({
	view,
	pageHref,
	position,
}: Readonly<{
	view: Readonly<{
		total: number;
		from: number;
		to: number;
		page: number;
		pages: number;
	}>;
	pageHref: (page: number) => string;
	position: "início" | "fim";
}>) {
	return (
		<div className={styles.queuePagination}>
			<p role="status">
				{view.total
					? `${view.from}–${view.to} de ${view.total} candidatos`
					: "Nenhum candidato corresponde aos filtros."}
			</p>
			<nav aria-label={`Páginas da fila de revisão · ${position}`}>
				{view.page > 1 ? (
					<Link href={pageHref(view.page - 1)}>Anterior</Link>
				) : (
					<span aria-disabled="true">Anterior</span>
				)}
				<span>
					Página {view.page} de {view.pages}
				</span>
				{view.page < view.pages ? (
					<Link href={pageHref(view.page + 1)}>Próxima</Link>
				) : (
					<span aria-disabled="true">Próxima</span>
				)}
			</nav>
		</div>
	);
}

export default async function NarrativeReviewPage({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	const [params, access] = await Promise.all([searchParams, currentAccess()]);
	const requestedCampaign = first(params.campanha);
	const requestedPath = requestedCampaign
		? reviewHref(requestedCampaign)
		: "/edit/revisao";
	if (access.state === "anonymous")
		redirect(`/entrar?next=${encodeURIComponent(requestedPath)}`);
	if (access.state === "unavailable") redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId) redirect("/conta?acesso=negado");

	const eligible = await readAuthorizedCampaignRoutes(
		access.context,
		EDIT_CAPABILITIES.reviewRead,
		{ includeArchived: true },
	);
	if (!eligible.ok) {
		return (
			<section
				className={styles.shell}
				data-layout-family="workspace"
				data-layout-role="editorial"
			>
				<OperationalPageHeader
					eyebrow="Edit · Revisão"
					title="Campanhas indisponíveis"
				/>
				<div className={styles.empty} role="status">
					<p>
						O diretório autorizado de campanhas não pôde ser consultado com
						segurança. Nenhum contexto de revisão foi assumido.
					</p>
				</div>
			</section>
		);
	}

	if (!eligible.campaigns.length) {
		return (
			<section
				className={styles.shell}
				data-layout-family="workspace"
				data-layout-role="editorial"
			>
				<OperationalPageHeader
					eyebrow="Edit · Revisão"
					title="Nenhuma campanha disponível"
				/>
				<div className={styles.empty} role="status">
					<p>
						Seu perfil não possui <code>{EDIT_CAPABILITIES.reviewRead}</code> em
						nenhuma campanha disponível.
					</p>
				</div>
			</section>
		);
	}

	const resultParam = first(params.resultado);
	const errorParam = first(params.erro);
	if (!requestedCampaign && eligible.campaigns.length === 1) {
		redirect(
			reviewHref(eligible.campaigns[0]!.routeKey, {
				resultado: resultParam,
				erro: errorParam,
			}),
		);
	}

	const selected = requestedCampaign
		? resolveAuthorizedCampaignReference(eligible.campaigns, requestedCampaign)
		: null;
	if (!selected) {
		return (
			<section
				className={styles.shell}
				data-layout-family="workspace"
				data-layout-role="editorial"
			>
				<OperationalPageHeader
					eyebrow="Edit · Revisão"
					title="Escolha a campanha"
					description={
						<p>
							A fila, as fontes e cada decisão permanecem isoladas no contexto
							de uma única campanha.
						</p>
					}
				/>
				<CampaignPicker
					campaigns={eligible.campaigns}
					invalidSelection={Boolean(requestedCampaign)}
				/>
			</section>
		);
	}

	const [queue, manageAccess, approvalAccess] = await Promise.all([
		loadCanonReviewQueue(selected.technicalSlug),
		Promise.resolve(
			authorizeCampaignCapability(
				access.context,
				EDIT_CAPABILITIES.reviewManage,
				selected.technicalSlug,
			),
		),
		Promise.resolve(
			authorizeCampaignCapability(
				access.context,
				EDIT_CAPABILITIES.canonApprove,
				selected.technicalSlug,
			),
		),
	]);
	const feedback = feedbackMessage(resultParam, errorParam);
	const active = selected.lifecycle === "active";
	const canManage = active && manageAccess.ok;
	const canApprove = active && approvalAccess.ok;
	const canDecide = canManage || canApprove;
	const search = (first(params.busca) ?? "").trim().slice(0, 200);
	const type = first(params.tipo) ?? "";
	const view = reviewQueueView(
		queue.ok ? queue.candidates : [],
		search,
		type,
		first(params.pagina) ?? "1",
	);
	const pageHref = (page: number) => {
		const query = new URLSearchParams();
		if (search) query.set("busca", search);
		if (type) query.set("tipo", type);
		if (page > 1) query.set("pagina", String(page));
		return `${reviewHref(selected.routeKey)}${query.size ? `?${query}` : ""}#fila-revisao`;
	};

	return (
		<section
			className={styles.shell}
			data-layout-family="workspace"
			data-layout-role="editorial"
		>
			<OperationalPageHeader
				eyebrow="Edit · Revisão"
				title="Revisão narrativa"
				description={
					<p>
						Compare cada candidato com suas fontes antes de registrar uma
						decisão.
					</p>
				}
				meta={selected.name}
			/>

			<CampaignPicker
				campaigns={eligible.campaigns}
				selected={selected.routeKey}
			/>

			<aside className={styles.notice}>
				<strong>Revisão privada · decisões humanas</strong>
				<details className={styles.reviewHelp}>
					<summary>Como funciona e permissões</summary>
					<p className={styles.muted}>
						Confira as fontes antes de decidir. As decisões desta tela não
						publicam no site nem conectam relações do Mundo automaticamente.
					</p>
					{active && !canManage ? (
						<p className={styles.muted}>
							A triagem exige <code>narrative.review.manage</code> nesta
							campanha.
						</p>
					) : null}
					{active && !canApprove ? (
						<p className={styles.muted}>
							A criação de cânone exige <code>narrative.canon.approve</code>{" "}
							nesta campanha.
						</p>
					) : null}
				</details>
				{!active ? (
					<p className={styles.campaignAlert} role="status">
						Campanha arquivada: leitura histórica permanece disponível, mas
						novas decisões estão bloqueadas.
					</p>
				) : null}
			</aside>

			{feedback ? (
				<p className={styles.feedback} role="status">
					<strong>{selected.name}:</strong> {feedback}
				</p>
			) : null}

			{!queue.ok ? (
				<div className={styles.empty} role="status">
					<h2>Fila indisponível</h2>
					<p>
						Não foi possível consultar candidates e suas fontes nesta campanha.
						Nenhuma decisão foi alterada.
					</p>
				</div>
			) : (
				<>
					<div className={styles.queueHeader} id="fila-revisao">
						<div>
							<h2>Candidatos pendentes · {selected.name}</h2>
							<p className={styles.muted}>
								Consulta de até 200 candidatos, em ordem de criação. Os filtros
								pesquisam os itens carregados.
							</p>
						</div>
						<strong>{queue.candidates.length} carregados</strong>
					</div>
					{queue.candidates.length ? (
						<>
							<form
								className={styles.queueFilters}
								action={reviewHref(selected.routeKey)}
								method="get"
							>
								<label htmlFor="review-search">
									Buscar candidato
									<input
										id="review-search"
										name="busca"
										type="search"
										maxLength={200}
										defaultValue={search}
										placeholder="Título, afirmação ou sessão"
									/>
								</label>
								<label htmlFor="review-type">
									Tipo
									<Select
										id="review-type"
										name="tipo"
										defaultValue={type}
										options={[
											{ value: "", label: "Todos os tipos" },
											...view.types.map((value) => ({
												value,
												label: value.replaceAll("_", " "),
											})),
										]}
										ariaLabel="Tipo de candidato"
									/>
								</label>
								<button type="submit">Filtrar</button>
								{search || type ? (
									<Link href={reviewHref(selected.routeKey)}>
										Limpar filtros
									</Link>
								) : null}
							</form>
							<QueuePagination
								view={view}
								pageHref={pageHref}
								position="início"
							/>
							{!view.total ? (
								<div className={styles.empty}>
									<h3>Nenhum resultado</h3>
									<p>
										Experimente outro termo ou limpe os filtros para voltar à
										fila.
									</p>
								</div>
							) : null}
						</>
					) : null}

					{view.items.length ? (
						<>
							<div className={styles.queue}>
								{view.items.map((candidate) => (
									<article className={styles.candidate} key={candidate.id}>
										<header className={styles.candidateHeader}>
											<div>
												<h3>{candidate.title}</h3>
												<p className={styles.meta}>
													{candidate.sessionTitle ?? "Sessão sem título"} ·{" "}
													{dateLabel(candidate.sessionDate)}
												</p>
											</div>
											<p className={styles.meta}>
												{candidate.candidateType} · {candidate.sourceCount}{" "}
												fontes
												{candidate.confidence === null
													? ""
													: " · confiança " +
														Math.round(candidate.confidence * 100) +
														"%"}
											</p>
										</header>

										<p className={styles.claim}>{candidate.claim}</p>

										<details className={styles.sources}>
											<summary>
												Fontes verificáveis ({candidate.sources.length} exibidas
												de {candidate.sourceCount})
											</summary>
											{candidate.sources.length ? (
												<ul>
													{candidate.sources.map((source) => (
														<li key={source.key}>
															<p className={styles.sourceMeta}>
																<strong>{source.label}</strong>
																{" · "}
																{source.kind === "transcript"
																	? "transcrição"
																	: "Roll20"}
																{source.startMs === null
																	? ""
																	: " · " + timeLabel(source.startMs)}
																{source.reviewStatus
																	? " · " + source.reviewStatus
																	: ""}
															</p>
															{source.text ? (
																<p className={styles.sourceText}>
																	{source.text}
																</p>
															) : (
																<p className={styles.sourceWarning}>
																	Conteúdo da fonte restrito nesta permissão. A
																	referência física foi validada, mas o texto
																	não foi exposto.
																</p>
															)}
														</li>
													))}
												</ul>
											) : (
												<p className={styles.sourceWarning}>
													A fonte declarada não pôde ser exibida. Não aprove
													como cânone sem verificar a evidência.
												</p>
											)}
											{candidate.sourceCount > candidate.sources.length ? (
												<p className={styles.meta}>
													A tela mostra no máximo 3 fontes por candidate para
													manter a revisão legível.
												</p>
											) : null}
										</details>

										{canDecide ? (
											<form
												action={reviewCanonCandidateFormAction}
												className={styles.form}
											>
												<input
													name="campaignSlug"
													type="hidden"
													value={selected.technicalSlug}
												/>
												<input
													name="candidateId"
													type="hidden"
													value={candidate.id}
												/>
												<label htmlFor={"decision-" + candidate.id}>
													Decisão
												</label>
												<Select
													id={"decision-" + candidate.id}
													name="decision"
													required
													defaultValue=""
													options={[
														{
															value: "",
															label: "Escolha depois de conferir as fontes",
															disabled: true,
														},
														...(canManage
															? [
																	{ value: "rejected", label: "Rejeitar" },
																	{
																		value: "interpretation",
																		label: "Interpretação, não fato",
																	},
																	{
																		value: "possible_hook",
																		label: "Possível gancho futuro",
																	},
																	{
																		value: "retcon_pending",
																		label: "Retcon/conflito pendente",
																	},
																	{
																		value: "private",
																		label:
																			"Privado / fora da memória compartilhada",
																	},
																]
															: []),
														...(canApprove
															? [
																	{
																		value: "approved_canon",
																		label: "Aprovar como cânone em revisão",
																	},
																]
															: []),
													]}
													ariaLabel="Decisão"
												/>

												<label htmlFor={"notes-" + candidate.id}>
													Nota da decisão (opcional)
												</label>
												<textarea
													id={"notes-" + candidate.id}
													maxLength={2000}
													name="reviewerNotes"
													placeholder="Explique conflito, inferência ou contexto sem repetir conteúdo desnecessariamente."
												/>
												<FormSubmitButton
													pendingLabel="Registrando…"
													variant="primary"
												>
													Registrar decisão
												</FormSubmitButton>
											</form>
										) : null}
									</article>
								))}
							</div>
							<QueuePagination view={view} pageHref={pageHref} position="fim" />
						</>
					) : !queue.candidates.length ? (
						<div className={styles.empty}>
							<h2>Nenhum candidato pendente</h2>
							<p>A fila humana está limpa para {selected.name}.</p>
						</div>
					) : null}
				</>
			)}
		</section>
	);
}
