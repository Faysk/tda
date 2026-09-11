"use client";

import { useEffect, useMemo, useState } from "react";
import {
	WORLD_VISIBILITIES,
	type WorldGraphDraft,
	type WorldVisibility,
} from "../model";
import styles from "./world-relation-authoring-controls.module.css";

export type WorldRelationCandidate = Readonly<{
	sourceId: string;
	targetId: string;
}>;

const VISIBILITY_LABELS: Record<WorldVisibility, string> = {
	private_master: "Privado · mestre",
	private_players: "Privado · jogadores",
	review_only: "Somente revisão",
	public_campaign: "Público · campanha",
	public_web: "Público · web",
};

export function WorldRelationAuthoringControls({
	enabled,
	draft,
	candidate,
	onCancel,
	onConfirm,
}: Readonly<{
	enabled: boolean;
	draft: WorldGraphDraft | null;
	candidate: WorldRelationCandidate | null;
	onCancel: () => void;
	onConfirm: (relationType: string, visibility: WorldVisibility) => void;
}>) {
	const activeTypes = useMemo(
		() => draft?.relationTypes.filter((type) => type.isActive) ?? [],
		[draft],
	);
	const [relationType, setRelationType] = useState("");
	const [visibility, setVisibility] = useState<WorldVisibility>("private_players");

	useEffect(() => {
		if (!candidate) {
			setRelationType("");
			setVisibility("private_players");
			return;
		}
		setRelationType(activeTypes[0]?.slug ?? "");
		setVisibility("private_players");
	}, [activeTypes, candidate]);

	useEffect(() => {
		if (!enabled) return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onCancel();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [enabled, onCancel]);

	if (!enabled || !draft) return null;

	const source = candidate ? draft.nodes.find((node) => node.id === candidate.sourceId) : null;
	const target = candidate ? draft.nodes.find((node) => node.id === candidate.targetId) : null;

	return (
		<div className={styles.root} data-world-relation-authoring>
			{candidate ? (
				<form
					className={styles.composer}
					onSubmit={(event) => {
						event.preventDefault();
						if (!relationType) return;
						onConfirm(relationType, visibility);
					}}
				>
					<header>
						<strong>Nova ligação</strong>
						<small>
							{source?.name ?? "Origem"} → {target?.name ?? "Destino"}
						</small>
					</header>
					<label>
						<span>Tipo</span>
						<select
							value={relationType}
							onChange={(event) => setRelationType(event.target.value)}
							required
						>
							{activeTypes.map((type) => (
								<option key={type.slug} value={type.slug}>
									{type.label}
								</option>
							))}
						</select>
					</label>
					<label>
						<span>Visibilidade</span>
						<select
							value={visibility}
							onChange={(event) => setVisibility(event.target.value as WorldVisibility)}
						>
							{WORLD_VISIBILITIES.map((value) => (
								<option key={value} value={value}>
									{VISIBILITY_LABELS[value]}
								</option>
							))}
						</select>
					</label>
					{visibility === "public_campaign" || visibility === "public_web" ? (
						<p className={styles.reviewNotice}>
							Publicação pública continua sujeita à fonte canônica e revisão existentes.
						</p>
					) : null}
					<div className={styles.actions}>
						<button type="submit" disabled={!relationType}>
							Criar ligação
						</button>
						<button type="button" onClick={onCancel}>
							Cancelar
						</button>
					</div>
				</form>
			) : (
				<div className={styles.modeNotice} role="status">
					<span aria-hidden="true">↗</span>
					<div>
						<strong>Conectar elementos</strong>
						<small>Arraste de um ponto azul até um ponto verde. Esc cancela.</small>
					</div>
					<button type="button" onClick={onCancel}>
						Cancelar
					</button>
				</div>
			)}
		</div>
	);
}
