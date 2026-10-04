"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
	moveSessionCampaignAction,
	preflightSessionCampaignMoveAction,
} from "./session-campaign-move-actions";
import {
	type SessionCampaignMoveClassification,
	type SessionCampaignMoveDestination,
	type SessionCampaignMoveOptions,
	type SessionCampaignMovePlanItem,
	type SessionCampaignMovePreview,
	sessionCampaignMoveConsequenceLabel,
	sessionCampaignMovePlanHeading,
} from "./session-campaign-move-model";
import {
	clearSessionCampaignMoveRecovery,
	loadSessionCampaignMoveRecovery,
	saveSessionCampaignMoveRecovery,
} from "./session-campaign-move-recovery";
import styles from "./session-campaign-move.module.css";

type MovePreflightRequest = Parameters<
	typeof preflightSessionCampaignMoveAction
>[0];
type MoveCommitRequest = Parameters<typeof moveSessionCampaignAction>[0];

export type SessionCampaignMoveTransport = Readonly<{
	preflight: (
		request: MovePreflightRequest,
	) => ReturnType<typeof preflightSessionCampaignMoveAction>;
	commit: (
		request: MoveCommitRequest,
	) => ReturnType<typeof moveSessionCampaignAction>;
}>;

const DEFAULT_TRANSPORT: SessionCampaignMoveTransport = {
	preflight: preflightSessionCampaignMoveAction,
	commit: moveSessionCampaignAction,
};

const PLAN_ORDER: readonly SessionCampaignMoveClassification[] = [
	"auto",
	"external_prepare",
	"decision",
	"historical",
	"hard_block",
];

type Props = Readonly<{
	sessionId: string;
	sourceSessionId: string;
	sourceCampaignSlug: string;
	sourceCampaignName: string;
	destinations: readonly SessionCampaignMoveDestination[];
	backendReady?: boolean;
	recoveryScope: string;
	transport?: SessionCampaignMoveTransport;
}>;

function failureLabel(reason: string): string {
	switch (reason) {
		case "forbidden":
		case "profile_unresolved":
			return "Seu perfil não possui autorização necessária nas duas campanhas.";
		case "conflict":
			return "A sessão mudou enquanto você trabalhava. Revalide o plano antes de continuar.";
		case "operation_conflict":
			return "A identidade desta operação já foi usada com outro plano. Inicie uma nova confirmação.";
		case "blocked":
			return "O plano ainda possui decisões ou dependências que impedem o commit.";
		case "not_found":
			return "A sessão ou uma das campanhas não está mais disponível.";
		case "validation":
			return "Os dados da mudança ficaram inválidos. Revalide e tente novamente.";
		case "media_prepare_required":
			return "A capa precisa ser preparada no namespace da campanha de destino antes do commit.";
		case "media_prepare_stale":
			return "A capa mudou enquanto era preparada. Revalide o plano e tente novamente.";
		case "media_prepare_unavailable":
			return "Não foi possível copiar e verificar a capa no destino. A sessão permaneceu na campanha atual.";
		case "dependency_unavailable":
			return "Mover campanha está temporariamente indisponível neste ambiente. Nenhuma alteração foi aplicada.";
		default:
			return "Não foi possível confirmar a mudança agora. Não presuma rollback nem commit sem revalidar.";
	}
}

function decisionPatch(
	item: SessionCampaignMovePlanItem,
	policy?: "preserve" | "revoke",
): Partial<SessionCampaignMoveOptions> | null {
	switch (item.actionId) {
		case "published_unpublish":
			return { publishedPolicy: "unpublish" };
		case "participant_entity_unlink":
			return { participantEntityPolicy: "unlink" };
		case "entity_mentions_detach":
			return { entityMentionPolicy: "detach_from_session" };
		case "canon_detach_entity_links":
			return { canonPolicy: "detach_entity_links" };
		case "legacy_cover_clear":
			return { legacyCoverPolicy: "clear_current" };
		case "session_grants":
			return policy ? { sessionGrantPolicy: policy } : null;
		default:
			return null;
	}
}

function decisionLabel(item: SessionCampaignMovePlanItem): string {
	switch (item.actionId) {
		case "published_unpublish":
			return "Confirmar despublicação durante o move";
		case "participant_entity_unlink":
			return "Remover vínculos com entities da origem";
		case "entity_mentions_detach":
			return "Destacar menções da sessão";
		case "canon_detach_entity_links":
			return "Remover links de entity dos candidatos";
		case "legacy_cover_clear":
			return "Iniciar o novo draft sem a capa legada";
		default:
			return "Confirmar esta decisão";
	}
}

export function SessionCampaignMovePanel({
	sessionId,
	sourceSessionId,
	sourceCampaignSlug,
	sourceCampaignName,
	destinations,
	backendReady = true,
	recoveryScope,
	transport = DEFAULT_TRANSPORT,
}: Props) {
	const router = useRouter();
	const [destination, setDestination] = useState(
		destinations[0]?.technicalSlug ?? "",
	);
	const [options, setOptions] = useState<SessionCampaignMoveOptions>({});
	const [preview, setPreview] = useState<SessionCampaignMovePreview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [operationId, setOperationId] = useState<string | null>(null);
	const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
	const [recovery, setRecovery] = useState<Readonly<{
		href: string;
		destinationName: string;
		destinationSlug: string;
		publicationState: "unpublished" | "unchanged";
	}> | null>(null);
	const [pending, startTransition] = useTransition();
	const selected = useMemo(
		() => destinations.find((item) => item.technicalSlug === destination),
		[destinations, destination],
	);

	const recoveryIdentity = useMemo(
		() => ({
			scope: recoveryScope,
			sessionId,
			sourceSessionId,
			sourceCampaignSlug,
			destinationCampaignSlug: destination,
		}),
		[
			recoveryScope,
			sessionId,
			sourceSessionId,
			sourceCampaignSlug,
			destination,
		],
	);

	useEffect(() => {
		setPreview(null);
		setError(null);
		setRecovery(null);
		setRecoveryNotice(null);
		setOptions({});
		setOperationId(null);
		if (!destination || typeof window === "undefined") return;
		const recovered = loadSessionCampaignMoveRecovery(
			window.localStorage,
			recoveryIdentity,
		);
		if (!recovered) return;
		setOptions(recovered.options);
		setOperationId(recovered.operationId);
		setRecoveryNotice(
			"Uma confirmação pendente foi recuperada deste navegador. Revalide o plano; se o commit anterior já ocorreu, o mesmo operationId será reconciliado sem duplicar a mudança.",
		);
	}, [destination, recoveryIdentity]);

	if (!destinations.length) return null;

	if (!backendReady) {
		return (
			<section
				className={styles.unavailable}
				data-testid="session-campaign-move-unavailable"
				role="status"
			>
				<strong>Mover campanha indisponível</strong>
				<span>
					O boundary v2 ainda não está ativo ou o registry de dependências não
					está íntegro neste ambiente. A sessão continua em {sourceCampaignName}.
				</span>
			</section>
		);
	}

	function request(nextOptions = options) {
		return {
			sessionId,
			sourceSessionId,
			sourceCampaignSlug,
			destinationCampaignSlug: destination,
			options: nextOptions,
		};
	}

	function runPreflightWith(nextOptions: SessionCampaignMoveOptions) {
		setError(null);
		setPreview(null);
		setRecovery(null);
		startTransition(async () => {
			const result = await transport.preflight(request(nextOptions));
			if (!result.ok) {
				setError(failureLabel(result.reason));
				return;
			}
			setPreview(result.preview);
		});
	}

	function runPreflight() {
		runPreflightWith(options);
	}

	function chooseDecision(
		item: SessionCampaignMovePlanItem,
		policy?: "preserve" | "revoke",
	) {
		const patch = decisionPatch(item, policy);
		if (!patch) return;
		const next = { ...options, ...patch };
		setOptions(next);
		setPreview(null);
		setError(null);
		setRecoveryNotice(null);
		setRecovery(null);
		setOperationId(null);
		if (typeof window !== "undefined") {
			clearSessionCampaignMoveRecovery(window.localStorage, recoveryIdentity);
		}
		runPreflightWith(next);
	}

	function commitMove(recoverUnresolved = false) {
		if (
			(!preview || preview.status !== "ready") &&
			!(recoverUnresolved && operationId && recoveryNotice)
		)
			return;
		const stableOperationId = operationId ?? crypto.randomUUID();
		if (!operationId) setOperationId(stableOperationId);
		setError(null);
		setRecoveryNotice(null);
		if (typeof window !== "undefined") {
			saveSessionCampaignMoveRecovery(
				window.localStorage,
				recoveryIdentity,
				stableOperationId,
				options,
			);
		}
		startTransition(async () => {
			try {
				const result = await transport.commit({
					...request(),
					operationId: stableOperationId,
				});
				if (!result.ok) {
					if ("preview" in result && result.preview) setPreview(result.preview);
					if (
						result.reason === "operation_conflict" ||
						result.reason === "validation" ||
						result.reason === "not_found"
					) {
						if (typeof window !== "undefined") {
							clearSessionCampaignMoveRecovery(
								window.localStorage,
								recoveryIdentity,
							);
						}
						setOperationId(null);
					}
					setError(failureLabel(result.reason));
					return;
				}

				if (typeof window !== "undefined") {
					clearSessionCampaignMoveRecovery(
						window.localStorage,
						recoveryIdentity,
					);
				}
				if (result.cachePending) {
					setError(null);
					setRecovery({
						href: result.destinationHref,
						destinationName: selected?.name ?? destination,
						destinationSlug: destination,
						publicationState: result.publicationState,
					});
					return;
				}
				setRecovery(null);
				router.replace(result.destinationHref);
				router.refresh();
			} catch {
				setError(
					"A resposta se perdeu. A identidade desta operação ficou salva localmente; revalide e confirme de novo para reconciliar o mesmo commit.",
				);
			}
		});
	}

	const groups = PLAN_ORDER.map((classification) => ({
		classification,
		items:
			preview?.planItems.filter(
				(item) => item.classification === classification,
			) ?? [],
	})).filter((group) => group.items.length > 0);

	return (
		<section
			className={styles.panel}
			aria-labelledby="session-move-title"
			data-testid="session-campaign-move-panel"
		>
			<details className={styles.disclosure}>
				<summary className={styles.summary}>
					<span>
						<strong id="session-move-title">Mover para outra campanha</strong>
						<small>Atual: {sourceCampaignName}</small>
					</span>
					<span className={styles.summaryHint}>
						Preflight → decisões → preparo → commit atômico
					</span>
				</summary>

				<div className={styles.body}>
					<div className={styles.controls}>
						<label>
							<span>Destino</span>
							<select
								aria-label="Mover para outra campanha"
								value={destination}
								onChange={(event) => setDestination(event.currentTarget.value)}
								disabled={pending || Boolean(recovery)}
							>
								{destinations.map((item) => (
									<option key={item.technicalSlug} value={item.technicalSlug}>
										{item.name}
									</option>
								))}
							</select>
						</label>
						<button
							type="button"
							onClick={runPreflight}
							disabled={pending || !selected || Boolean(recovery)}
						>
							{pending ? "Verificando…" : "Pré-validar mudança"}
						</button>
					</div>

					{recoveryNotice ? (
						<div className={styles.recoveryNotice} role="status">
							<span>{recoveryNotice}</span>
							<button
								type="button"
								disabled={pending || !operationId}
								onClick={() => commitMove(true)}
							>
								{pending ? "Reconciliando…" : "Reconciliar operação pendente"}
							</button>
						</div>
					) : null}
					{error ? <p className={styles.error} role="alert">{error}</p> : null}

					{recovery ? (
						<div className={styles.recovery} role="status">
							<strong>Commit confirmado.</strong>
							<span>
								Destino confirmado: {recovery.destinationName} (
								{recovery.destinationSlug}).
							</span>
							{recovery.publicationState === "unpublished" ? (
								<span>
									A versão pública ativa foi despublicada de forma explícita.
									O histórico foi preservado; publique novamente no destino quando
									estiver pronto.
								</span>
							) : null}
							<span>
								A sessão já mudou no banco. A revalidação de cache/delivery ficou
								pendente; isso não desfaz o commit.
							</span>
							<button
								type="button"
								onClick={() => {
									router.replace(recovery.href);
									router.refresh();
								}}
							>
								Abrir destino confirmado
							</button>
						</div>
					) : null}

					{preview ? (
						<div className={styles.preview} data-status={preview.status}>
							<header className={styles.previewHeader}>
								<div>
									<h3>
										{preview.status === "ready"
											? "Plano pronto para confirmar"
											: "Plano precisa de atenção"}
									</h3>
									<p>
										{sourceCampaignName} → {selected?.name ?? destination}
									</p>
								</div>
								<span>{preview.contractVersion}</span>
							</header>

							{groups.map((group) => (
								<section
									className={styles.planGroup}
									data-classification={group.classification}
									key={group.classification}
								>
									<h4>{sessionCampaignMovePlanHeading(group.classification)}</h4>
									<ul>
										{group.items.map((item) => (
											<li key={`${item.code}:${item.actionId ?? ""}`}>
												<div className={styles.planItemHeader}>
													<strong>{item.message}</strong>
													<span>
														{item.count} {item.count === 1 ? "item" : "itens"}
													</span>
												</div>

												{item.classification === "decision" && !item.resolved ? (
													<div className={styles.decisionActions}>
														{item.actionId === "session_grants" ? (
															<>
																<button
																	type="button"
																	onClick={() => chooseDecision(item, "preserve")}
																	disabled={pending}
																>
																	Preservar grants
																</button>
																<button
																	type="button"
																	onClick={() => chooseDecision(item, "revoke")}
																	disabled={pending}
																>
																	Revogar grants
																</button>
															</>
														) : (
															<button
																type="button"
																onClick={() => chooseDecision(item)}
																disabled={pending}
															>
																{decisionLabel(item)}
															</button>
														)}
													</div>
												) : item.classification === "decision" &&
												  item.resolved ? (
													<span className={styles.resolvedDecision}>
														✓ Decisão confirmada
														{item.selectedPolicy
															? ` · ${item.selectedPolicy}`
															: ""}
													</span>
												) : null}

												<details className={styles.technicalDetails}>
													<summary>Detalhes técnicos</summary>
													<code>{item.code}</code>
													<span>família: {item.family}</span>
												</details>
											</li>
										))}
									</ul>
								</section>
							))}

							{preview.consequences.length ? (
								<section className={styles.consequences}>
									<h4>Depois do commit</h4>
									<ul>
										{preview.consequences.map((item) => (
											<li key={item}>
												{sessionCampaignMoveConsequenceLabel(item)}
											</li>
										))}
									</ul>
								</section>
							) : null}

							{preview.status === "ready" ? (
								<div className={styles.confirmation}>
									<strong>Confirmação final</strong>
									<span>
										O servidor vai revalidar o mesmo plano, preparar a mídia
										quando necessário e só então executar o commit.
									</span>
									<button type="button" onClick={() => commitMove()} disabled={pending}>
										{pending
											? "Movendo…"
											: `Confirmar mudança para ${selected?.name ?? "destino"}`}
									</button>
								</div>
							) : (
								<p className={styles.blockedHint}>
									Resolva as decisões acima ou o blocker indicado e execute o
									preflight novamente. Nenhum write foi feito.
								</p>
							)}
						</div>
					) : null}
				</div>
			</details>
		</section>
	);
}
