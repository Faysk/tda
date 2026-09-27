"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/features/edit/workbench.module.css";
import {
	prepareSessionPublicationAction,
	publishSessionEditorialDraftAction,
} from "./session-publication-actions";
import type { SessionPublicationConfirmation } from "./session-publication-model";

type Props = Readonly<{
	sessionId: string;
}>;

type PendingOperation = Readonly<{
	operationId: string;
	draftId: string;
	draftRevision: number;
	expectedCurrentPublicationId: string | null;
}>;

function storageKey(sessionId: string) {
	return "tda:session-publication-operation:" + sessionId;
}

function readPending(
	sessionId: string,
	confirmation: SessionPublicationConfirmation,
): PendingOperation | null {
	try {
		const raw = sessionStorage.getItem(storageKey(sessionId));
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<PendingOperation>;
		if (
			typeof value.operationId === "string" &&
			value.draftId === confirmation.draftId &&
			value.draftRevision === confirmation.draftRevision &&
			value.expectedCurrentPublicationId ===
				confirmation.expectedCurrentPublicationId
		) {
			return value as PendingOperation;
		}
	} catch {
		// A corrupt local hint is never authoritative.
	}
	return null;
}

function reasonMessage(reason: string): string {
	switch (reason) {
		case "draft_not_saved":
			return "Salve o draft editorial antes de publicar.";
		case "draft_not_ready":
			return "O draft ainda não possui título, descrição curta e resumo completo válidos.";
		case "cover_not_ready":
			return "Finalize uma capa privada verificada antes de publicar.";
		case "stale_transcript":
			return "A transcrição mudou desde a base do draft. Rebase/revise o draft antes de publicar.";
		case "stale_current":
		case "stale_confirmation":
		case "stale_draft":
			return "A sessão mudou depois da confirmação. Recarregue o estado e confirme novamente.";
		case "cover_promote_conflict":
			return "Outra operação alterou o estado da capa. A sessão pública anterior foi preservada.";
		case "forbidden":
		case "profile_unresolved":
			return "Sua conta pode editar, mas não possui a capability de publicação desta sessão.";
		case "unauthenticated":
			return "Sua sessão expirou. Entre novamente antes de publicar.";
		case "conflict":
			return "Esta operation id já existe com outro payload. O sistema recusou a duplicação.";
		default:
			return "A publicação não foi confirmada. O draft e a versão pública anterior foram preservados; tente novamente com a mesma operação.";
	}
}

export function SessionPublicationControl({ sessionId }: Props) {
	const router = useRouter();
	const [confirmation, setConfirmation] =
		useState<SessionPublicationConfirmation | null>(null);
	const [operationId, setOperationId] = useState<string | null>(null);
	const [phase, setPhase] = useState<
		"idle" | "preparing" | "publishing" | "error" | "success"
	>("idle");
	const [message, setMessage] = useState<string | null>(null);

	async function prepare() {
		if (phase === "preparing" || phase === "publishing") return;
		setPhase("preparing");
		setMessage(null);
		const result = await prepareSessionPublicationAction(sessionId);
		if (!result.ok) {
			setPhase("error");
			setMessage(reasonMessage(result.reason));
			return;
		}

		const current = readPending(sessionId, result.confirmation);
		const pending: PendingOperation =
			current ?? {
				operationId: crypto.randomUUID(),
				draftId: result.confirmation.draftId,
				draftRevision: result.confirmation.draftRevision,
				expectedCurrentPublicationId:
					result.confirmation.expectedCurrentPublicationId,
			};
		try {
			sessionStorage.setItem(storageKey(sessionId), JSON.stringify(pending));
		} catch {
			// Server idempotency remains authoritative if storage is unavailable.
		}
		setOperationId(pending.operationId);
		setConfirmation(result.confirmation);
		setPhase("idle");
	}

	async function publish() {
		if (!confirmation || !operationId || phase === "publishing") return;
		setPhase("publishing");
		setMessage(null);
		const result = await publishSessionEditorialDraftAction({
			sessionId: confirmation.sessionId,
			operationId,
			expectedCurrentPublicationId:
				confirmation.expectedCurrentPublicationId,
			draftId: confirmation.draftId,
			draftRevision: confirmation.draftRevision,
			transcriptRevisionId: confirmation.transcriptRevisionId,
			coverAssetId: confirmation.coverAssetId,
		});
		if (!result.ok) {
			setPhase("error");
			setMessage(reasonMessage(result.reason));
			return;
		}

		try {
			sessionStorage.removeItem(storageKey(sessionId));
		} catch {
			// Receipt in the database is the source of truth.
		}
		setPhase("success");
		setMessage(
			"Versão pública v" +
				result.receipt.versionNumber +
				" confirmada." +
				(result.cachePending
					? " O commit está feito; a propagação do cache ficou pendente."
					: ""),
		);
		setConfirmation(null);
		setOperationId(null);
		router.refresh();
	}

	const label =
		confirmation?.currentVersionNumber || phase === "success"
			? "Publicar nova versão"
			: "Publicar no site";

	return (
		<div className={styles.publicationControl}>
			<button
				className={styles.controlButton}
				disabled={phase === "preparing" || phase === "publishing"}
				onClick={() => void prepare()}
				type="button"
			>
				{phase === "preparing" ? "Verificando…" : label}
			</button>

			{message ? (
				<p
					className={
						phase === "success"
							? styles.publicationSuccess
							: styles.publicationError
					}
					role={phase === "success" ? "status" : "alert"}
				>
					{message}
				</p>
			) : null}

			{confirmation ? (
				<div className={styles.publishDialogBackdrop}>
					<div
						aria-describedby="session-publish-description"
						aria-labelledby="session-publish-title"
						aria-modal="true"
						className={styles.publishDialog}
						role="dialog"
					>
						<div>
							<span className={styles.muted}>CONFIRMAÇÃO PÚBLICA</span>
							<h3 id="session-publish-title">
								Publicar esta sessão no site?
							</h3>
							<p
								className={styles.muted}
								id="session-publish-description"
							>
								Salvar draft e publicar são operações separadas. Esta ação
								cria uma versão pública imutável.
							</p>
						</div>

						<dl className={styles.publishSummary}>
							<div>
								<dt>Capa</dt>
								<dd>
									pronta · {confirmation.coverWidth}×
									{confirmation.coverHeight}
								</dd>
							</div>
							<div>
								<dt>Arco</dt>
								<dd>{confirmation.arc || "sem arco"}</dd>
							</div>
							<div>
								<dt>Título</dt>
								<dd>{confirmation.title}</dd>
							</div>
							<div>
								<dt>Descrição</dt>
								<dd>
									{confirmation.shortDescriptionChars.toLocaleString(
										"pt-BR",
									)}{" "}
									caracteres
								</dd>
							</div>
							<div>
								<dt>Resumo completo</dt>
								<dd>
									{confirmation.fullSummaryChars.toLocaleString("pt-BR")}{" "}
									caracteres · Markdown
								</dd>
							</div>
							<div>
								<dt>Versão pública atual</dt>
								<dd>
									{confirmation.currentVersionNumber
										? "v" + confirmation.currentVersionNumber
										: "nenhuma"}
								</dd>
							</div>
							<div>
								<dt>Base do draft</dt>
								<dd>r{confirmation.draftRevision}</dd>
							</div>
							<div>
								<dt>Transcript base</dt>
								<dd>cloud transcript r{confirmation.transcriptRevisionNumber}</dd>
							</div>
						</dl>

						<p className={styles.privatePublicationWarning}>
							A transcrição completa continuará privada.
						</p>

						<div className={styles.publishDialogActions}>
							<button
								className={styles.controlButton}
								disabled={phase === "publishing"}
								onClick={() => setConfirmation(null)}
								type="button"
							>
								Cancelar
							</button>
							<button
								className={styles.filterButton}
								disabled={phase === "publishing"}
								onClick={() => void publish()}
								type="button"
							>
								{phase === "publishing"
									? "Publicando…"
									: confirmation.currentVersionNumber
										? "Publicar nova versão"
										: "Publicar no site"}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
