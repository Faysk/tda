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
	transport = DEFAULT_TRANSPORT,
}: Props) {
	const router = useRouter();
	const [destination, setDestination] = useState(destinations[0]?.technicalSlug ?? "");
	const [preview, setPreview] = useState<SessionCampaignMovePreview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [operationId, setOperationId] = useState<string | null>(null);
	const [recoveryHref, setRecoveryHref] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const selected = useMemo(
		() => destinations.find((item) => item.technicalSlug === destination),
		[destinations, destination],
	);

	if (!destinations.length) {
		return (
			<section className={styles.panel} aria-labelledby="session-move-title">
				<div>
					<p className={styles.eyebrow}>Campanha atual</p>
					<h2 id="session-move-title">{sourceCampaignName}</h2>
				</div>
				<p className={styles.muted}>
					Não há outra campanha ativa em que você possua leitura da transcrição e edição de conteúdo.
				</p>
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
		setRecoveryHref(null);
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
					setRecoveryHref(result.destinationHref);
					return;
				}
				setRecoveryHref(null);
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
		<section className={styles.panel} aria-labelledby="session-move-title">
			<div className={styles.heading}>
				<div>
					<p className={styles.eyebrow}>Campanha atual</p>
					<h2 id="session-move-title">{sourceCampaignName}</h2>
				</div>
				<p className={styles.muted}>Mover é uma operação separada do draft editorial.</p>
			</div>

			<div className={styles.controls}>
				<label>
					<span>Mover para outra campanha</span>
					<select
						value={destination}
						onChange={(event) => {
							setDestination(event.currentTarget.value);
							setPreview(null);
							setError(null);
							setOperationId(null);
							setRecoveryHref(null);
						}}
						disabled={pending}
					>
						{destinations.map((item) => (
							<option key={item.technicalSlug} value={item.technicalSlug}>
								{item.name}
							</option>
						))}
					</select>
				</label>
				<button type="button" onClick={runPreflight} disabled={pending || !selected}>
					{pending ? "Verificando…" : "Pré-validar mudança"}
				</button>
			</div>

			{error ? <p className={styles.error} role="alert">{error}</p> : null}

			{recoveryHref ? (
				<div className={styles.recovery} role="status">
					<strong>Commit confirmado.</strong>
					<span>
						A sessão já mudou de campanha no banco. A revalidação de cache/delivery
						 ficou pendente; isso não desfaz o commit.
					</span>
					<button
						type="button"
						onClick={() => {
							router.replace(recoveryHref);
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
								? recoveryHref
									? "Revalidando…"
									: "Movendo…"
								: recoveryHref
									? "Revalidar caches"
									: `Confirmar mudança para ${selected?.name ?? "destino"}`}
						</button>
					) : null}
				</div>
			) : null}
		</section>
	);
}
