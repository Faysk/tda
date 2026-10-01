"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { prepareLegacyTranscriptAction } from "./legacy-prepare-actions";
import type { LegacyTranscriptPrepareResult } from "./legacy-prepare-model";
import styles from "./legacy-transcript-prepare.module.css";

type Phase = "idle" | "confirm" | "preparing" | "error" | "prepared";

export type LegacyTranscriptPrepareAction = typeof prepareLegacyTranscriptAction;

export function LegacyTranscriptPrepare({
	campaignSlug,
	sessionId,
	sessionTitle,
	segmentCount,
	snapshotSha256,
	editable,
	action = prepareLegacyTranscriptAction,
}: Readonly<{
	campaignSlug: string;
	sessionId: string;
	sessionTitle: string;
	segmentCount: number;
	snapshotSha256: string;
	editable: boolean;
	action?: LegacyTranscriptPrepareAction;
}>) {
	const router = useRouter();
	const [phase, setPhase] = useState<Phase>("idle");
	const [message, setMessage] = useState("");
	const operationId = useRef<string | null>(null);

	function resetAttempt(result?: LegacyTranscriptPrepareResult) {
		if (
			!result ||
			result.ok ||
			result.reason !== "dependency_unavailable"
		) {
			operationId.current = null;
		}
	}

	async function prepare() {
		if (!editable || phase === "preparing") return;
		if (!operationId.current) operationId.current = crypto.randomUUID();
		setPhase("preparing");
		setMessage("Preparando uma revisão privada sem alterar a sessão pública…");

		let result: LegacyTranscriptPrepareResult;
		try {
			result = await action({
				campaignSlug,
				sessionId,
				operationId: operationId.current,
				expectedSnapshotSha256: snapshotSha256,
			});
		} catch {
			setPhase("error");
			setMessage(
				"Não foi possível confirmar a preparação. A mesma tentativa será reutilizada no próximo retry.",
			);
			return;
		}

		if (result.ok) {
			resetAttempt(result);
			setPhase("prepared");
			setMessage(
				`Revisão privada r${result.revisionNumber} pronta. Abrindo o editor moderno…`,
			);
			router.refresh();
			return;
		}

		resetAttempt(result);
		setPhase("error");
		if (result.reason === "stale_legacy") {
			setMessage(
				"A transcrição mudou desde que esta página foi aberta. Recarregue antes de preparar; nada foi gravado.",
			);
			return;
		}
		if (result.reason === "empty_legacy") {
			setMessage("Esta sessão não possui falas legadas para preparar.");
			return;
		}
		if (result.reason === "invalid_legacy") {
			setMessage(
				"A transcrição antiga possui dados que não cabem com segurança no contrato moderno. Nada foi alterado.",
			);
			return;
		}
		if (
			result.reason === "forbidden" ||
			result.reason === "profile_unresolved" ||
			result.reason === "unauthenticated"
		) {
			setMessage("Sua permissão de edição não está disponível. Nada foi alterado.");
			return;
		}
		if (result.reason === "operation_conflict") {
			setMessage(
				"A identidade desta tentativa já foi usada por outra operação. Recarregue a sessão antes de continuar.",
			);
			return;
		}
		setMessage(
			"Não foi possível confirmar a preparação agora. A transcrição continua preservada para leitura.",
		);
	}

	return (
		<section className={styles.card} aria-label="Preparar transcrição antiga para edição">
			<div className={styles.copy}>
				<span className={styles.eyebrow}>FORMATO ANTERIOR</span>
				<h2>Prepare esta transcrição para edição</h2>
				<p>
					Esta sessão foi criada antes do sistema atual de revisões. A preparação
					cria uma cópia privada e imutável usando exatamente a transcrição que
					você está vendo.
				</p>
			</div>

			<dl className={styles.facts}>
				<div>
					<dt>Sessão</dt>
					<dd>{sessionTitle}</dd>
				</div>
				<div>
					<dt>Falas</dt>
					<dd>{segmentCount.toLocaleString("pt-BR")}</dd>
				</div>
				<div>
					<dt>Destino</dt>
					<dd>Edit privado</dd>
				</div>
				<div>
					<dt>Site público</dt>
					<dd>não será alterado</dd>
				</div>
			</dl>

			{phase === "confirm" ? (
				<div className={styles.confirm} role="dialog" aria-label="Confirmar preparação">
					<strong>Preparar esta sessão no formato atual?</strong>
					<p>
						Nenhuma fala ou timestamp será corrigido automaticamente. O histórico
						legado continua preservado e nenhuma publicação será criada.
					</p>
					<div className={styles.actions}>
						<Button
							onClick={() => setPhase("idle")}
							variant="tertiary"
						>
							Cancelar
						</Button>
						<Button
							disabled={!editable}
							onClick={() => void prepare()}
						>
							Preparar para edição
						</Button>
					</div>
				</div>
			) : (
				<div className={styles.actions}>
					<Button
						disabled={!editable || phase === "preparing" || phase === "prepared"}
						onClick={() => setPhase("confirm")}
					>
						{phase === "preparing"
							? "Preparando…"
							: phase === "prepared"
								? "Preparada"
								: "Preparar para edição"}
					</Button>
					{!editable ? (
						<span className={styles.muted}>Sua conta possui acesso somente para leitura.</span>
					) : null}
				</div>
			)}

			{message ? (
				<p
					className={styles.message}
					data-state={phase}
					role={phase === "error" ? "alert" : "status"}
				>
					{message}
				</p>
			) : null}

			<details className={styles.details}>
				<summary>Detalhes técnicos</summary>
				<code>{snapshotSha256}</code>
			</details>
		</section>
	);
}
