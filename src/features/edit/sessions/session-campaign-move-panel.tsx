"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import {
	moveSessionCampaignAction,
	previewSessionCampaignMoveAction,
} from "./session-campaign-move-actions";
import {
	isSessionCampaignMoveBlocker,
	sessionCampaignMoveBlockerMessage,
	type SessionCampaignMoveBlocker,
	type SessionCampaignMovePreview,
} from "./session-campaign-move";
import styles from "./session-campaign-move.module.css";

type Destination = Readonly<{
	technicalSlug: string;
	name: string;
}>;

type Phase =
	| "idle"
	| "previewing"
	| "ready"
	| "blocked"
	| "moving"
	| "error"
	| "moved";

export function SessionCampaignMovePanel({
	currentCampaignSlug,
	currentCampaignName,
	sessionId,
	sourceSessionId,
	destinations,
}: Readonly<{
	currentCampaignSlug: string;
	currentCampaignName: string;
	sessionId: string;
	sourceSessionId: string;
	destinations: readonly Destination[];
}>) {
	const router = useRouter();
	const [destinationSlug, setDestinationSlug] = useState("");
	const [preview, setPreview] = useState<SessionCampaignMovePreview | null>(null);
	const [phase, setPhase] = useState<Phase>("idle");
	const [message, setMessage] = useState("");
	const [confirmed, setConfirmed] = useState(false);
	const [blockers, setBlockers] = useState<readonly SessionCampaignMoveBlocker[]>([]);
	const operationId = useRef<string | null>(null);

	function resetForDestination(value: string) {
		setDestinationSlug(value);
		setPreview(null);
		setConfirmed(false);
		setBlockers([]);
		setMessage("");
		setPhase("idle");
		operationId.current = null;
	}

	async function runPreflight() {
		if (!destinationSlug || phase === "previewing" || phase === "moving") return;
		setPhase("previewing");
		setMessage("Verificando dependências, permissões e vínculos da sessão…");
		setPreview(null);
		setConfirmed(false);
		setBlockers([]);
		operationId.current = null;

		try {
			const result = await previewSessionCampaignMoveAction({
				sourceCampaignSlug: currentCampaignSlug,
				destinationCampaignSlug: destinationSlug,
				sessionId,
				sourceSessionId,
			});
			if (!result.ok) {
				setPhase("error");
				setMessage(
					result.reason === "forbidden"
						? "Sua conta não possui permissão de edição nas duas campanhas. Nada foi alterado."
						: result.reason === "not_found"
							? "A sessão ou uma das campanhas não está mais disponível neste escopo."
							: result.reason === "validation"
								? "O pedido de move não passou pela validação de identidade."
								: "Não foi possível concluir o preflight. Nada foi alterado.",
				);
				return;
			}

			setPreview(result.preview);
			setBlockers(result.preview.blockers);
			if (result.preview.ready) {
				setPhase("ready");
				setMessage(
					"Preflight aprovado: " +
						result.preview.sourceCampaignName +
						" → " +
						result.preview.destinationCampaignName +
						".",
				);
				return;
			}
			setPhase("blocked");
			setMessage(
				"O move foi bloqueado antes de qualquer escrita. Resolva os itens abaixo e rode o preflight novamente.",
			);
		} catch {
			setPhase("error");
			setMessage("O preflight não pôde ser confirmado. Nada foi alterado.");
		}
	}

	async function commit() {
		if (
			!preview ||
			!preview.ready ||
			!confirmed ||
			phase === "moving" ||
			phase === "previewing"
		) {
			return;
		}
		if (!operationId.current) operationId.current = crypto.randomUUID();

		setPhase("moving");
		setMessage("Movendo a sessão em uma transação única…");
		try {
			const result = await moveSessionCampaignAction({
				sourceCampaignSlug: currentCampaignSlug,
				destinationCampaignSlug: preview.destinationCampaignSlug,
				sessionId,
				sourceSessionId,
				expectedUpdatedAt: preview.expectedUpdatedAt,
				operationId: operationId.current,
			});
			if (!result.ok) {
				if (result.reason === "blocked") {
					const currentBlockers = (result.blockers ?? []).filter(
						isSessionCampaignMoveBlocker,
					);
					setBlockers(currentBlockers);
					setPhase("blocked");
					setConfirmed(false);
					setMessage(
						"As dependências mudaram depois do preflight. O commit foi cancelado sem escrita.",
					);
					operationId.current = null;
					return;
				}
				if (result.reason === "conflict") {
					setPhase("error");
					setConfirmed(false);
					setPreview(null);
					setMessage(
						"A sessão mudou depois do preflight. Nada foi sobrescrito; rode a verificação novamente.",
					);
					operationId.current = null;
					return;
				}
				if (result.reason === "operation_conflict") {
					setPhase("error");
					setMessage(
						"A identidade desta operação já foi usada com outro payload. Rode um novo preflight.",
					);
					setConfirmed(false);
					setPreview(null);
					operationId.current = null;
					return;
				}
				setPhase("error");
				setMessage(
					result.reason === "forbidden"
						? "A permissão de origem ou destino mudou. Nada foi movido."
						: result.reason === "not_found"
							? "A sessão não está mais no escopo verificado. Nada foi movido."
							: result.reason === "validation"
								? "O commit foi recusado por identidade inválida."
								: "Não foi possível confirmar a resposta do move. Tente novamente: a mesma identidade de operação será reutilizada com segurança.",
				);
				return;
			}

			setPhase("moved");
			setMessage(
				result.cachePending
					? "Move confirmado no banco. Parte da invalidação de cache falhou; abrindo a rota canônica do destino, que lê o estado autoritativo."
					: result.status === "replay"
						? "O commit já havia ocorrido e foi recuperado pelo receipt idempotente."
						: "Move concluído e auditado. Abrindo a campanha de destino…",
			);
			router.push(result.destinationHref);
			router.refresh();
		} catch {
			setPhase("error");
			setMessage(
				"Não foi possível confirmar a resposta do commit. Tente novamente sem alterar o destino; a mesma operação será reutilizada.",
			);
		}
	}

	if (!destinations.length) {
		return (
			<section className={styles.panel} aria-labelledby="session-move-title">
				<div>
					<p className={styles.eyebrow}>CAMPANHA</p>
					<h2 id="session-move-title">Mover para outra campanha</h2>
					<p>
						Esta sessão pertence a <strong>{currentCampaignName}</strong>.
					</p>
				</div>
				<p className={styles.notice} role="status">
					Não há outra campanha ativa onde sua conta possua permissão de edição.
				</p>
			</section>
		);
	}

	return (
		<section className={styles.panel} aria-labelledby="session-move-title">
			<div className={styles.heading}>
				<div>
					<p className={styles.eyebrow}>CAMPANHA</p>
					<h2 id="session-move-title">Mover para outra campanha</h2>
				</div>
				<span className={styles.current}>{currentCampaignName}</span>
			</div>

			<p className={styles.copy}>
				O move altera o escopo físico da sessão. Transcrição e draft privados
				podem acompanhar a sessão, mas publicação ativa, mídia campaign-scoped,
				entidades/canon e grants específicos bloqueiam a operação até serem
				resolvidos.
			</p>

			<div className={styles.controls}>
				<label>
					<span>Campanha de destino</span>
					<select
						disabled={phase === "moving" || phase === "previewing"}
						value={destinationSlug}
						onChange={(event) => resetForDestination(event.currentTarget.value)}
					>
						<option value="">Selecione…</option>
						{destinations.map((destination) => (
							<option
								key={destination.technicalSlug}
								value={destination.technicalSlug}
							>
								{destination.name}
							</option>
						))}
					</select>
				</label>
				<Button
					disabled={
						!destinationSlug || phase === "moving" || phase === "previewing"
					}
					onClick={() => void runPreflight()}
					variant="secondary"
				>
					{phase === "previewing" ? "Verificando…" : "Verificar move"}
				</Button>
			</div>

			{message ? (
				<p
					className={styles.message}
					data-state={phase}
					role={phase === "error" || phase === "blocked" ? "alert" : "status"}
					aria-live="polite"
				>
					{message}
				</p>
			) : null}

			{blockers.length ? (
				<ul className={styles.blockers}>
					{blockers.map((blocker) => (
						<li key={blocker}>{sessionCampaignMoveBlockerMessage(blocker)}</li>
					))}
				</ul>
			) : null}

			{preview?.ready ? (
				<div className={styles.confirmation}>
					<dl className={styles.facts}>
						<div>
							<dt>Origem</dt>
							<dd>{preview.sourceCampaignName}</dd>
						</div>
						<div>
							<dt>Destino</dt>
							<dd>{preview.destinationCampaignName}</dd>
						</div>
						<div>
							<dt>ID da origem</dt>
							<dd>{preview.sourceSessionId}</dd>
						</div>
					</dl>
					<label className={styles.confirmCheck}>
						<input
							checked={confirmed}
							disabled={phase === "moving"}
							onChange={(event) => setConfirmed(event.currentTarget.checked)}
							type="checkbox"
						/>
						<span>
							Confirmo o destino e entendo que o TDA não copiará entidades,
							canon ou mídia implicitamente.
						</span>
					</label>
					<Button
						disabled={!confirmed || phase === "moving"}
						onClick={() => void commit()}
					>
						{phase === "moving" ? "Movendo…" : "Mover sessão"}
					</Button>
				</div>
			) : null}
		</section>
	);
}
