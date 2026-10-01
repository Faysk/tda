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
	published_session: "A sessão possui publicação ativa.",
	transcript_revision: "A sessão já possui revisão moderna de transcrição.",
	editorial_draft: "A sessão possui draft editorial.",
	publication_history: "A sessão possui histórico de publicação.",
	session_media: "Há mídia de sessão no namespace da campanha atual.",
	review_or_canon: "Há decisões de revisão ou candidatos de cânone ligados à sessão.",
	entity_linked_participant: "Há participante já ligado a entidade da campanha.",
	destination_source_collision: "O mesmo identificador de origem já existe no destino.",
	invalid_target: "A campanha de destino não é válida para este movimento.",
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
	const [phase, setPhase] = useState<"idle" | "checking" | "ready" | "blocked" | "moving" | "error">("idle");
	const [blockers, setBlockers] = useState<readonly SessionMoveBlocker[]>([]);
	const [message, setMessage] = useState("");
	const operationId = useRef<string | null>(null);
	const target = destinations.find((item) => item.technicalSlug === destination) ?? null;

	if (!destinations.length) return null;

	async function preflight() {
		if (!target || phase === "checking" || phase === "moving") return;
		setPhase("checking");
		setMessage("Verificando dependências e colisões…");
		const result = await preflightSessionCampaignMoveAction({
			sessionId,
			sourceCampaignSlug,
			destinationCampaignSlug: target.technicalSlug,
		});
		if (result.ok) {
			setBlockers([]);
			setPhase("ready");
			setMessage("Preflight limpo. Nenhuma escrita foi feita.");
			return;
		}
		const nextBlockers = "blockers" in result ? result.blockers : [];
		setBlockers(nextBlockers);
		setPhase(nextBlockers.length ? "blocked" : "error");
		setMessage(
			nextBlockers.length
				? "O movimento foi bloqueado antes de qualquer escrita."
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
					"? A sessão não será clonada.",
			)
		)
			return;
		if (!operationId.current) operationId.current = crypto.randomUUID();
		setPhase("moving");
		setMessage("Movendo sessão de forma atômica…");
		const result = await moveSessionCampaignAction({
			operationId: operationId.current,
			sessionId,
			sourceCampaignSlug,
			destinationCampaignSlug: target.technicalSlug,
		});
		if (!result.ok) {
			const nextBlockers = "blockers" in result ? result.blockers : [];
			setBlockers(nextBlockers);
			setPhase(nextBlockers.length ? "blocked" : "error");
			setMessage(
				nextBlockers.length
					? "O estado mudou e o movimento foi bloqueado sem escrita parcial."
					: "O movimento não foi confirmado. A mesma operação pode ser repetida com segurança.",
			);
			if (result.reason !== "dependency_unavailable") operationId.current = null;
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
				<Button disabled={!target || phase === "checking" || phase === "moving"} onClick={() => void preflight()} variant="secondary">
					{phase === "checking" ? "Verificando…" : "Verificar movimento"}
				</Button>
				<Button disabled={phase !== "ready"} onClick={() => void move()}>
					{phase === "moving" ? "Movendo…" : "Mover sessão"}
				</Button>
			</div>
			{message ? <p role={phase === "error" || phase === "blocked" ? "alert" : "status"}>{message}</p> : null}
			{blockers.length ? (
				<ul>
					{blockers.map((blocker) => <li key={blocker}>{BLOCKERS[blocker]}</li>)}
				</ul>
			) : null}
		</details>
	);
}
