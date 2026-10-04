"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
	moveSessionCampaignAction,
	preflightSessionCampaignMoveAction,
} from "./session-campaign-move-actions";
import {
	EMPTY_SESSION_CAMPAIGN_MOVE_DECISIONS,
	type SessionCampaignMoveDecisionState,
	type SessionCampaignMoveDestination,
	type SessionCampaignMovePlanClassification,
	type SessionCampaignMovePreview,
	requiredSessionCampaignMoveDecisions,
	sessionCampaignMoveConsequenceLabel,
	sessionCampaignMovePlanHeading,
	sessionCampaignMoveRecoveryKey,
	validSessionCampaignMoveRecoveryIntent,
} from "./session-campaign-move-model";
import {
	clearSessionCampaignMoveRecovery,
	persistSessionCampaignMoveRecovery,
	readSessionCampaignMoveRecovery,
} from "./session-campaign-move-recovery";
import styles from "./session-campaign-move.module.css";

type MovePreflightRequest = Parameters<typeof preflightSessionCampaignMoveAction>[0];
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

type Props = Readonly<{
	sessionId: string;
	sourceSessionId: string;
	sourceCampaignSlug: string;
	sourceCampaignName: string;
	destinations: readonly SessionCampaignMoveDestination[];
	backendReady?: boolean;
	transport?: SessionCampaignMoveTransport;
}>;

const PLAN_ORDER: readonly SessionCampaignMovePlanClassification[] = [
	"auto",
	"external_prepare",
	"decision",
	"historical",
];

function failureLabel(reason: string): string {
	switch (reason) {
		case "forbidden":
		case "profile_unresolved":
			return "Seu perfil não possui autorização suficiente para concluir esta transferência.";
		case "conflict":
			return "A sessão mudou enquanto você trabalhava. Recarregue o preflight antes de confirmar.";
		case "operation_conflict":
			return "Esta identidade de operação pertence a outra transferência. Gere um novo preflight.";
		case "decision_required":
			return "Confirme as reconciliações obrigatórias antes de mover.";
		case "preparation_required":
			return "A mídia ainda precisa ser preparada no destino.";
		case "preparation_conflict":
			return "A capa mudou depois da preparação. Rode o preflight novamente.";
		case "cover_unverified":
			return "A capa não passou pela cópia/read-back no namespace de destino. Nada foi movido.";
		case "blocked":
			return "A mudança continua bloqueada por dependências que não podem ser reconciliadas automaticamente.";
		case "not_found":
			return "A sessão ou uma das campanhas não está mais disponível.";
		case "validation":
			return "Os dados da mudança ficaram inválidos. Recarregue e tente novamente.";
		case "dependency_unavailable":
			return "Mover campanha está temporariamente indisponível neste ambiente. Nenhuma alteração parcial deve ser assumida.";
		default:
			return "Não foi possível confirmar a mudança agora. Confira o estado atual antes de iniciar outra operação.";
	}
}

export function SessionCampaignMovePanel({
	sessionId,
	sourceSessionId,
	sourceCampaignSlug,
	sourceCampaignName,
	destinations,
	backendReady = true,
	transport = DEFAULT_TRANSPORT,
}: Props) {
	const router = useRouter();
	const [destination, setDestination] = useState(destinations[0]?.technicalSlug ?? "");
	const [preview, setPreview] = useState<SessionCampaignMovePreview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [operationId, setOperationId] = useState<string | null>(null);
	const [decisions, setDecisions] = useState<SessionCampaignMoveDecisionState>(
		EMPTY_SESSION_CAMPAIGN_MOVE_DECISIONS,
	);
	const [recovery, setRecovery] = useState<Readonly<{
		href: string;
		destinationName: string;
		destinationSlug: string;
	}> | null>(null);
	const [pending, startTransition] = useTransition();
	const selected = useMemo(
		() => destinations.find((item) => item.technicalSlug === destination),
		[destinations, destination],
	);
	const requiredDecisions = requiredSessionCampaignMoveDecisions(preview);
	const decisionsReady =
		(!requiredDecisions.unlinkParticipantEntities ||
			decisions.unlinkParticipantEntities) &&
		(!requiredDecisions.revokeSessionGrants || decisions.revokeSessionGrants);
	const groupedPlan = useMemo(
		() =>
			PLAN_ORDER.map((classification) => ({
				classification,
				items: (preview?.plan ?? []).filter(
					(item) => item.classification === classification,
				),
			})).filter((group) => group.items.length > 0),
		[preview],
	);

	useEffect(() => {
		const stored = readSessionCampaignMoveRecovery(sessionId);
		if (!validSessionCampaignMoveRecoveryIntent(stored)) return;
		if (
			stored.sessionId !== sessionId ||
			stored.sourceSessionId !== sourceSessionId ||
			stored.sourceCampaignSlug !== sourceCampaignSlug ||
			!destinations.some(
				(item) => item.technicalSlug === stored.destinationCampaignSlug,
			)
		) {
			clearSessionCampaignMoveRecovery(sessionId);
			return;
		}
		setDestination(stored.destinationCampaignSlug);
		setOperationId(stored.operationId);
		setDecisions(EMPTY_SESSION_CAMPAIGN_MOVE_DECISIONS);
		setError(
			"Há uma transferência pendente desta sessão. Rode o preflight e confirme novamente; a mesma operationId será reutilizada.",
		);
	}, [
		destinations,
		sessionId,
		sourceCampaignSlug,
		sourceSessionId,
	]);

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
					O backend deste ambiente ainda não possui o contrato v2. A sessão
					continua em {sourceCampaignName}.
				</span>
			</section>
		);
	}

	const request = {
		sessionId,
		sourceSessionId,
		sourceCampaignSlug,
		destinationCampaignSlug: destination,
	};

	function resetMoveIntent() {
		setOperationId(null);
		setDecisions(EMPTY_SESSION_CAMPAIGN_MOVE_DECISIONS);
		setRecovery(null);
		clearSessionCampaignMoveRecovery(sessionId);
	}

	function runPreflight() {
		setError(null);
		setPreview(null);
		setRecovery(null);
		startTransition(async () => {
			const result = await transport.preflight(request);
			if (!result.ok) {
				setError(failureLabel(result.reason));
				return;
			}
			setPreview(result.preview);
		});
	}

	function commitMove() {
		if (preview?.status !== "ready" || !decisionsReady) return;
		const stableOperationId = operationId ?? crypto.randomUUID();
		if (!operationId) setOperationId(stableOperationId);
		const intent = {
			version: 1 as const,
			sessionId,
			sourceSessionId,
			sourceCampaignSlug,
			destinationCampaignSlug: destination,
			operationId: stableOperationId,
		};
		persistSessionCampaignMoveRecovery(intent);
		setError(null);
		startTransition(async () => {
			try {
				const result = await transport.commit({
					...request,
					operationId: stableOperationId,
					decisions,
				});
				if (!result.ok) {
					if ("preview" in result && result.preview) setPreview(result.preview);
					if (
						result.reason === "operation_conflict" ||
						result.reason === "validation"
					) {
						clearSessionCampaignMoveRecovery(sessionId);
						setOperationId(null);
					}
					setError(failureLabel(result.reason));
					return;
				}
				clearSessionCampaignMoveRecovery(sessionId);
				if (result.cachePending) {
					setError(null);
					setRecovery({
						href: result.destinationHref,
						destinationName: selected?.name ?? destination,
						destinationSlug: destination,
					});
					return;
				}
				setRecovery(null);
				router.replace(result.destinationHref);
				router.refresh();
			} catch {
				setError(
					"A resposta se perdeu. O intent foi preservado nesta aba; rode o preflight e confirme novamente para reutilizar a mesma operação com segurança.",
				);
			}
		});
	}

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
					<span className={styles.summaryHint}>Preflight → preparo → commit atômico</span>
				</summary>

				<div className={styles.body}>
					<div className={styles.controls}>
						<label>
							<span>Destino</span>
							<select
								aria-label="Mover para outra campanha"
								value={destination}
								onChange={(event) => {
									setDestination(event.currentTarget.value);
									setPreview(null);
									setError(null);
									resetMoveIntent();
								}}
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

					{error ? <p className={styles.error} role="alert">{error}</p> : null}

					{recovery ? (
						<div className={styles.recovery} role="status">
							<strong>Commit confirmado.</strong>
							<span>
								Destino confirmado: {recovery.destinationName} ({recovery.destinationSlug}).
							</span>
							<span>
								A sessão já mudou de campanha no banco. A revalidação de cache/delivery
								ficou pendente; isso não desfaz o commit.
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
							<h3>
								{preview.status === "ready"
									? "Plano de transferência"
									: "Mudança bloqueada"}
							</h3>

							{preview.blockers.length ? (
								<section aria-label="Bloqueadores">
									<strong>Precisa ser resolvido antes</strong>
									<ul>
										{preview.blockers.map((blocker) => (
											<li key={blocker.code}>
												<strong>{blocker.message}</strong>
												<details>
													<summary>Detalhes técnicos</summary>
													<span>{blocker.count} · {blocker.code}</span>
												</details>
											</li>
										))}
									</ul>
								</section>
							) : null}

							{groupedPlan.map((group) => (
								<section
									key={group.classification}
									aria-label={sessionCampaignMovePlanHeading(group.classification)}
								>
									<strong>{sessionCampaignMovePlanHeading(group.classification)}</strong>
									<ul>
										{group.items.map((item) => (
											<li key={item.family}>
												<span>{item.message}</span>
												<small>{item.count} · {item.family}</small>
											</li>
										))}
									</ul>
								</section>
							))}

							{requiredDecisions.unlinkParticipantEntities ? (
								<label>
									<input
										type="checkbox"
										checked={decisions.unlinkParticipantEntities}
										onChange={(event) =>
											setDecisions((current) => ({
												...current,
												unlinkParticipantEntities: event.currentTarget.checked,
											}))
										}
									/>
									Desvincular entities narrativas dos participantes, preservando os participantes e seus nomes históricos.
								</label>
							) : null}
							{requiredDecisions.revokeSessionGrants ? (
								<label>
									<input
										type="checkbox"
										checked={decisions.revokeSessionGrants}
										onChange={(event) =>
											setDecisions((current) => ({
												...current,
												revokeSessionGrants: event.currentTarget.checked,
											}))
										}
									/>
									Revogar grants específicos desta sessão antes de transferir o boundary.
								</label>
							) : null}

							{preview.consequences.length ? (
								<details>
									<summary>Consequências da transferência</summary>
									<ul>
										{preview.consequences.map((item) => (
											<li key={item}>{sessionCampaignMoveConsequenceLabel(item)}</li>
										))}
									</ul>
								</details>
							) : null}

							{preview.status === "ready" ? (
								<button
									type="button"
									onClick={commitMove}
									disabled={pending || !decisionsReady}
								>
									{pending
										? recovery
											? "Revalidando…"
											: "Preparando e movendo…"
										: recovery
											? "Revalidar caches"
											: `Confirmar mudança para ${selected?.name ?? "destino"}`}
								</button>
							) : null}
						</div>
					) : null}
				</div>
			</details>
		</section>
	);
}
