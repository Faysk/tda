"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
	moveSessionCampaignAction,
	preflightSessionCampaignMoveAction,
} from "./session-move-actions";
import type { SessionMoveBlocker } from "./session-move-model";
import styles from "@/features/edit/workbench.module.css";

type Destination = Readonly<{ technicalSlug: string; name: string }>;

const BLOCKERS: Record<SessionMoveBlocker, string> = {
	published_session:
		"A sessão está publicada. O move não altera URL pública nem publicação implicitamente; despublique ou use uma migração editorial dedicada antes de mover.",
	transcript_revision:
		"A sessão possui revisão moderna de transcrição. Esse histórico é campaign-bound e não é reescrito pelo move seguro.",
	editorial_draft:
		"A sessão possui draft editorial. O draft precisa permanecer na campanha de origem até existir uma política explícita de rebind.",
	publication_history:
		"A sessão possui histórico/receipt de publicação. O move seguro não reescreve snapshots públicos nem receipts.",
	session_media:
		"Há mídia no namespace da campanha atual. O objeto não será renomeado, copiado ou religado silenciosamente.",
	review_or_canon:
		"Há revisão, candidato ou memória canônica ligada à sessão. O move não duplica nem reclassifica canon.",
	entity_linked_participant:
		"Há participante ligado a uma entidade da campanha atual. O personagem não será copiado pelo nome para o destino.",
	session_evidence_or_lineage:
		"Há fontes, eventos, segmentos, jobs ou outra provenance ligada à sessão. Esse lineage precisa de uma política de rebind antes do move.",
	session_scoped_access:
		"Há acesso/RBAC explicitamente scoped à sessão. O grant precisa ser revisado antes do move.",
	destination_source_collision:
		"O mesmo identificador de origem já existe no destino. Escolha outra sessão/destino ou resolva a colisão primeiro.",
	invalid_target:
		"A campanha de destino não está ativa ou não é um destino válido para este movimento.",
};

export function SessionCampaignMoveControl({
	sessionId,
	sourceSessionId,
	sourceCampaignSlug,
	sourceCampaignName,
	destinations,
}: Readonly<{
	sessionId: string;
	sourceSessionId: string;
	sourceCampaignSlug: string;
	sourceCampaignName: string;
	destinations: readonly Destination[];
}>) {
	const router = useRouter();
	const [destination, setDestination] = useState("");
	const [phase, setPhase] = useState<
		"idle" | "checking" | "ready" | "blocked" | "moving" | "error"
	>("idle");
	const [blockers, setBlockers] = useState<readonly SessionMoveBlocker[]>([]);
	const [message, setMessage] = useState("");
	const operationId = useRef<string | null>(null);
	const target =
		destinations.find((item) => item.technicalSlug === destination) ?? null;

	if (!destinations.length) return null;

	async function preflight() {
		if (!target || phase === "checking" || phase === "moving") return;
		setPhase("checking");
		setMessage("Verificando autoridade, dependências, provenance e colisões…");
		const result = await preflightSessionCampaignMoveAction({
			sessionId,
			sourceSessionId,
			sourceCampaignSlug,
			destinationCampaignSlug: target.technicalSlug,
		});
		if (result.ok) {
			setBlockers([]);
			setPhase("ready");
			setMessage(
				"Preflight limpo. Nenhuma escrita foi feita. O commit moverá a identidade da sessão sem clonar conteúdo e registrará auditoria.",
			);
			return;
		}
		const nextBlockers: readonly SessionMoveBlocker[] =\n\t\t\t"blockers" in result && result.blockers ? result.blockers : [];
		setBlockers(nextBlockers);
		setPhase(nextBlockers.length ? "blocked" : "error");
		setMessage(
			nextBlockers.length
				? "O movimento foi bloqueado antes de qualquer escrita."
				: result.reason === "forbidden"
					? "Sua autorização mudou ou não cobre origem e destino. Nada foi escrito."
					: "Não foi possível confirmar o preflight.",
		);
	}

	async function move() {
		if (!target || phase !== "ready") return;
		if (
			!window.confirm(
				"Mover esta sessão de " +
					sourceCampaignName +
					" para " +
					target.name +
					"? A sessão não será clonada e qualquer estado novo desde o preflight pode bloquear o commit.",
			)
		)
			return;
		if (!operationId.current) operationId.current = crypto.randomUUID();
		setPhase("moving");
		setMessage("Movendo sessão de forma atômica…");
		const result = await moveSessionCampaignAction({
			operationId: operationId.current,
			sessionId,
			sourceSessionId,
			sourceCampaignSlug,
			destinationCampaignSlug: target.technicalSlug,
		});
		if (!result.ok) {
			const nextBlockers: readonly SessionMoveBlocker[] =\n\t\t\t"blockers" in result && result.blockers ? result.blockers : [];
			setBlockers(nextBlockers);
			setPhase(nextBlockers.length ? "blocked" : "error");
			setMessage(
				nextBlockers.length
					? "O estado mudou e o movimento foi bloqueado sem escrita parcial."
					: result.reason === "conflict"
						? "O estado da sessão ou do destino mudou durante o commit. Nada parcial foi mantido; execute o preflight novamente."
						: result.reason === "operation_conflict"
							? "Este receipt pertence a outro pedido. Gere um novo preflight antes de tentar de novo."
							: result.reason === "forbidden"
								? "Sua autorização mudou antes do commit. Nada foi escrito."
								: "O movimento não foi confirmado. Em falha de transporte, a mesma operação pode ser repetida com segurança.",
			);
			if (result.reason !== "dependency_unavailable")
				operationId.current = null;
			return;
		}
		operationId.current = null;
		router.push(
			"/edit/" +
				encodeURIComponent(target.technicalSlug) +
				"/sessoes/" +
				encodeURIComponent(sourceSessionId),
		);
		router.refresh();
	}

	return (
		<details className={styles.libraryGuidance}>
			<summary>Mover sessão para outra campanha</summary>
			<p className={styles.muted}>
				Esta é uma operação separada do draft. Primeiro fazemos um preflight sem
				escritas; dependências que não possuem política segura de rebind bloqueiam
				o move.
			</p>
			<div className={styles.libraryFilterActions}>
				<label>
					<span>Destino</span>
					<select
						className={styles.control}
						disabled={phase === "moving"}
						onChange={(event) => {
							setDestination(event.target.value);
							setPhase("idle");
							setBlockers([]);
							setMessage("");
							operationId.current = null;
						}}
						value={destination}
					>
						<option value="">Escolha a campanha</option>
						{destinations.map((item) => (
							<option key={item.technicalSlug} value={item.technicalSlug}>
								{item.name}
							</option>
						))}
					</select>
				</label>
				<Button
					disabled={!target || phase === "checking" || phase === "moving"}
					onClick={() => void preflight()}
					variant="secondary"
				>
					{phase === "checking" ? "Verificando…" : "Verificar movimento"}
				</Button>
				<Button disabled={phase !== "ready"} onClick={() => void move()}>
					{phase === "moving" ? "Movendo…" : "Mover sessão"}
				</Button>
			</div>
			{message ? (
				<p role={phase === "error" || phase === "blocked" ? "alert" : "status"}>
					{message}
				</p>
			) : null}
			{blockers.length ? (
				<ul>
					{blockers.map((blocker) => (
						<li key={blocker}>{BLOCKERS[blocker]}</li>
					))}
				</ul>
			) : null}
		</details>
	);
}
