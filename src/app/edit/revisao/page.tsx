import type { Metadata } from "next";
import { PublicLink as Link } from "@/components/public-link";
import {
	authorizeCampaignCapabilityServer,
	requireCapability,
} from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { approveCanonCandidateFormAction } from "@/features/edit/review/actions";
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

function feedbackMessage(result: string | undefined, error: string | undefined) {
	if (result === "approved")
		return "Candidato aprovado como cânone em revisão. Nenhuma publicação pública foi feita.";
	if (result === "unchanged")
		return "Este candidato já estava aprovado; nenhuma evidência foi duplicada.";
	if (error === "forbidden")
		return "Sua conta pode revisar, mas não possui autoridade para aprovar cânone.";
	if (error === "not_found")
		return "O candidato não está mais disponível nesta campanha.";
	if (error === "invalid_state" || error === "conflict")
		return "O candidato mudou desde a abertura da página. Atualize a fila antes de decidir.";
	if (error)
		return "Não foi possível concluir a aprovação. Nenhuma alteração parcial foi mantida.";
	return null;
}

export default async function NarrativeReviewPage({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	await requireCapability(EDIT_CAPABILITIES.reviewRead, "/edit/revisao");

	const [queue, approvalAccess, params] = await Promise.all([
		loadCanonReviewQueue(),
		authorizeCampaignCapabilityServer({
			action: EDIT_CAPABILITIES.canonApprove,
			campaignSlug: CAMPAIGN_SLUG,
		}),
		searchParams,
	]);
	const feedback = feedbackMessage(first(params.resultado), first(params.erro));
	const canApprove = approvalAccess.ok;

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
					Revise candidatos extraídos da campanha antes de qualquer entrada
					canônica. Aprovar aqui cria apenas cânone <code>review_only</code>.
				</p>
			</header>

			<aside className={styles.notice}>
				<strong>Gate humano obrigatório.</strong>
				<p className={styles.muted}>
					Esta tela não publica no site e não conecta uma relação do World
					automaticamente. Depois da aprovação, a provenance da relação ainda
					precisa ser escolhida e publicada deliberadamente no editor do Mundo.
				</p>
				{!canApprove ? (
					<p className={styles.muted}>
						Sua permissão atual é de leitura/revisão. A aprovação final exige{" "}
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
						Não foi possível consultar a revisão agora. Nenhuma decisão foi
						alterada.
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

									{canApprove ? (
										<form
											action={approveCanonCandidateFormAction}
											className={styles.form}
										>
											<input
												name="candidateId"
												type="hidden"
												value={candidate.id}
											/>
											<label htmlFor={"notes-" + candidate.id}>
												Nota da decisão (opcional)
											</label>
											<textarea
												id={"notes-" + candidate.id}
												maxLength={2000}
												name="reviewerNotes"
												placeholder="Contexto editorial da aprovação, sem necessidade de repetir o conteúdo."
											/>
											<button type="submit">
												Aprovar como cânone em revisão
											</button>
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
