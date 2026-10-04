"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
	moveSessionCampaignAction,
	preflightSessionCampaignMoveAction,
} from "./session-campaign-move-actions";
import {
	type SessionCampaignMoveDestination,
	type SessionCampaignMovePreview,
	sessionCampaignMoveConsequenceLabel,
} from "./session-campaign-move-model";
import styles from "./session-campaign-move.module.css";

type MovePreflightRequest = Parameters<typeof preflightSessionCampaignMoveAction>[0];
type MoveCommitRequest = Parameters<typeof moveSessionCampaignAction>[0];

export type SessionCampaignMoveTransport = Readonly<{
	preflight: (
		request: MovePreflightRequest,
	) => ReturnType<typeof preflightSessionCampaignMoveAction>;
	commit: (
		request: MoveCommitRequest,
	) => ReturnType<typeof moveSessionCampaignMoveAction>;
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

function failureLabel(reason: string): string {
	switch (reason) {
		case "forbidden":
		case "profile_unresolved":
			return "Seu perfil não possui autorização nas duas campanhas.";
		case "conflict":
			return "A sessão mudou de campanha ou identidade enquanto você trabalhava. Recarregue a página.";
		case "operation_conflict":
			return "Este identificador de operação já foi usado para outra mudança.";
		case "blocked":
			return "A mudança está bloqueada pelas dependências atuais.";
		case "not_found":
			return "A sessão ou uma das campanhas não está mais disponível.";
		case "validation":
			return "Os dados da mudança ficaram inválidos. Recarregue e tente novamente.";
		case "dependency_unavailable":
			return "Mover campanha está temporariamente indisponível neste ambiente. Nenhuma alteração foi aplicada.";
		default:
			return "Não foi possível confirmar a mudança agora. Nenhuma alteração parcial deve ser assumida.";
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
					A operação ainda não está ativa neste ambiente. A sessão continua em{" "}
					{sourceCampaignName}.
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

	function runPreflight() {
		setError(null);
		setPreview(null);
		setOperationId(null);
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
		if (!preview || preview.status !== "ready") return;
		const stableOperationId = operationId ?? crypto.randomUUID();
		if (!operationId) setOperationId(stableOperationId);
		setError(null);
		startTransition(async () => {
			try {
				const result = await transport.commit({
					...request,
					operationId: stableOperationId,
				});
				if (!result.ok) {
					if ("preview" in result && result.preview) setPreview(result.preview);
					setError(failureLabel(result.reason));
					return;
				}
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
					"A resposta se perdeu. Use “Confirmar mudança” novamente: o mesmo operationId será reutilizado com segurança.",
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
					<span className={styles.summaryHint}>Operação separada do draft editorial</span>
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
									setOperationId(null);
									setRecovery(null);
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
							<h3>{preview.status === "ready" ? "Pronta para confirmar" : "Mudança bloqueada"}</h3>
							{preview.blockers.length ? (
								<ul>
									{preview.blockers.map((blocker) => (
										<li key={blocker.code}>
											<strong>{blocker.message}</strong>
											<span>{blocker.count} dependência(s) · {blocker.code}</span>
										</li>
									))}
								</ul>
							) : (
								<ul>
									{preview.consequences.map((item) => (
										<li key={item}>{sessionCampaignMoveConsequenceLabel(item)}</li>
									))}
								</ul>
							)}
							{preview.status === "ready" ? (
								<button type="button" onClick={commitMove} disabled={pending}>
									{pending
										? recovery
											? "Revalidando…"
											: "Movendo…"
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
