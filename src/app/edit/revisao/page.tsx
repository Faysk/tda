import type { Metadata } from "next";
import { PublicLink as Link } from "@/components/public-link";
import {
	authorizeCampaignCapabilityServer,
	requireCapability,
} from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { reviewCanonCandidateFormAction } from "@/features/edit/review/actions";
import { loadCanonReviewQueue } from "@/features/edit/review/server";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import styles from "@/features/edit/review/review.module.css";

export const metadata: Metadata = {
	title: "Revisão narrativa · Edit",
	description: "Fila humana de revisão antes da entrada no cânone da campanha.",
};
export const dynamic = "force-dynamic";

type SearchParams = Promise<
	Readonly<{
		resultado?: string | string[];
		erro?: string | string[];
	}>
>;

function first(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value;
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
	return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}

function feedbackMessage(result: string | undefined, error: string | undefined) {
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
		return "Sua conta não possui autoridade para esta decisão.";
	if (error === "not_found")
		return "O candidato não está mais disponível nesta campanha.";
	if (error === "invalid_state" || error === "conflict")
		return "O candidato mudou desde a abertura da página. Atualize a fila antes de decidir.";
	if (error)
		return "Não foi possível concluir a revisão. Nenhuma alteração parcial foi mantida.";
	return null;
}

export default async function NarrativeReviewPage({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	await requireCapability(EDIT_CAPABILITIES.reviewRead, "/edit/revisao");

	const [queue, manageAccess, approvalAccess, params] = await Promise.all([
		loadCanonReviewQueue(),
		authorizeCampaignCapabilityServer({
			action: EDIT_CAPABILITIES.reviewManage,
			campaignSlug: CAMPAIGN_SLUG,
		}),
		authorizeCampaignCapabilityServer({
			action: EDIT_CAPABILITIES.canonApprove,
			campaignSlug: CAMPAIGN_SLUG,
		}),
		searchParams,
	]);
	const feedback = feedbackMessage(first(params.resultado), first(params.erro));
	const canManage = manageAccess.ok;
	const canApprove = approvalAccess.ok;
	const canDecide = canManage || canApprove;

	return (
		<section className={styles.shell}>
			<nav className={styles.navigation} aria-label="Navegação do Edit">
				<Link href="/edit">← Ferramentas administrativas</Link>
				<Link href="/edit/mundo">Mundo</Link>
			</nav>

			<header className={styles.header}>
				<p className={styles.eyebrow}>TDA / EDIT / REVISÃO</p>
				<h1>Revisão narrativa</h1>
				<p className={styles.lead}>
					Compare cada claim com suas fontes antes de decidir. Só a opção de
					cânone cria uma entrada <code>review_only</code>; as demais classificam
					o candidate sem publicar conteúdo.
				</p>
			</header>

			<aside className={styles.notice}>
				<strong>Gate humano obrigatório.</strong>
				<p className={styles.muted}>
					Nada desta tela publica no site ou conecta uma relação do World
					automaticamente. Provenance, decisão e audience continuam etapas
					separadas.
				</p>
				{!canManage ? (
					<p className={styles.muted}>
						A triagem exige <code>narrative.review.manage</code>.
					</p>
				) : null}
				{!canApprove ? (
					<p className={styles.muted}>
						A criação de cânone exige, separadamente,{" "}
						<code>narrative.canon.approve</code>.
					</p>
				) : null}
			</aside>

			{feedback ? (
				<p className={styles.feedback} role="status">
					{feedback}
				</p>
			) : null}

			{!queue.ok ? (
				<div className={styles.empty} role="status">
					<h2>Fila indisponível</h2>
					<p>
						Não foi possível consultar candidates e suas fontes agora. Nenhuma
						decisão foi alterada.
					</p>
				</div>
			) : (
				<>
					<div className={styles.queueHeader}>
						<div>
							<h2>Candidatos pendentes</h2>
							<p className={styles.muted}>
								Até 200 itens por consulta, em ordem de criação.
							</p>
						</div>
						<strong>{queue.candidates.length} pendentes</strong>
					</div>

					{queue.candidates.length ? (
						<div className={styles.queue}>
							{queue.candidates.map((candidate) => (
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
											{candidate.candidateType} · {candidate.sourceCount} fontes
											{candidate.confidence === null
												? ""
												: " · confiança " +
													Math.round(candidate.confidence * 100) +
													"%"}
										</p>
									</header>

									<p className={styles.claim}>{candidate.claim}</p>

									<details className={styles.sources} open>
										<summary>
											Fontes verificáveis ({candidate.sources.length} exibidas de{" "}
											{candidate.sourceCount})
										</summary>
										{candidate.sources.length ? (
											<ul>
												{candidate.sources.map((source, index) => (
													<li key={source.kind + "-" + index}>
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
														<p className={styles.sourceText}>{source.text}</p>
													</li>
												))}
											</ul>
										) : (
											<p className={styles.sourceWarning}>
												A fonte declarada não pôde ser exibida. Não aprove como
												cânone sem verificar a evidência.
											</p>
										)}
										{candidate.sourceCount > candidate.sources.length ? (
											<p className={styles.meta}>
												A tela mostra no máximo 3 fontes por candidate para manter
												a revisão legível.
											</p>
										) : null}
									</details>

									{canDecide ? (
										<form
											action={reviewCanonCandidateFormAction}
											className={styles.form}
										>
											<input
												name="candidateId"
												type="hidden"
												value={candidate.id}
											/>
											<label htmlFor={"decision-" + candidate.id}>
												Decisão
											</label>
											<select
												id={"decision-" + candidate.id}
												name="decision"
												required
												defaultValue=""
											>
												<option value="" disabled>
													Escolha depois de conferir as fontes
												</option>
												{canManage ? (
													<>
														<option value="rejected">Rejeitar</option>
														<option value="interpretation">
															Interpretação, não fato
														</option>
														<option value="possible_hook">
															Possível gancho futuro
														</option>
														<option value="retcon_pending">
															Retcon/conflito pendente
														</option>
														<option value="private">
															Privado / fora da memória compartilhada
														</option>
													</>
												) : null}
												{canApprove ? (
													<option value="approved_canon">
														Aprovar como cânone em revisão
													</option>
												) : null}
											</select>

											<label htmlFor={"notes-" + candidate.id}>
												Nota da decisão (opcional)
											</label>
											<textarea
												id={"notes-" + candidate.id}
												maxLength={2000}
												name="reviewerNotes"
												placeholder="Explique conflito, inferência ou contexto sem repetir conteúdo desnecessariamente."
											/>
											<button type="submit">Registrar decisão</button>
										</form>
									) : null}
								</article>
							))}
						</div>
					) : (
						<div className={styles.empty}>
							<h2>Nenhum candidato pendente</h2>
							<p>A fila humana está limpa para esta campanha.</p>
						</div>
					)}
				</>
			)}
		</section>
	);
}
