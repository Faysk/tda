"use client";

import { useEffect, useRef, useState } from "react";
import type { WorldEntityType, WorldPositionHint } from "../model";
import {
	WORLD_DIRECT_CREATE_TYPES,
	worldEntityTypeLabel,
} from "../world-direct-create";
import styles from "./world-direct-create-controls.module.css";

function isTypingTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
	);
}

export function WorldDirectCreateControls({
	enabled,
	placementType,
	placementPoint,
	onSelectType,
	onCancel,
	onCreate,
}: Readonly<{
	enabled: boolean;
	placementType: WorldEntityType | null;
	placementPoint: WorldPositionHint | null;
	onSelectType: (type: WorldEntityType) => void;
	onCancel: () => void;
	onCreate: (name: string) => void;
}>) {
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [name, setName] = useState("");
	const nameInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!enabled) {
			setPaletteOpen(false);
			setName("");
		}
	}, [enabled]);

	useEffect(() => {
		if (!placementPoint) {
			setName("");
			return;
		}
		nameInputRef.current?.focus();
	}, [placementPoint]);

	useEffect(() => {
		if (!enabled) return;
		function onKeyDown(event: KeyboardEvent) {
			if (isTypingTarget(event.target)) return;
			if (
				(event.key.toLocaleLowerCase("pt-BR") === "n" || event.key === "+") &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey
			) {
				event.preventDefault();
				setPaletteOpen(true);
				return;
			}
			if (event.key === "Escape" && (paletteOpen || placementType || placementPoint)) {
				event.preventDefault();
				setPaletteOpen(false);
				setName("");
				onCancel();
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [enabled, onCancel, paletteOpen, placementPoint, placementType]);

	if (!enabled) return null;

	return (
		<div className={styles.root} data-world-direct-create>
			<button
				className={styles.trigger}
				type="button"
				onClick={() => setPaletteOpen((open) => !open)}
				aria-expanded={paletteOpen}
				aria-haspopup="dialog"
				aria-label="Novo elemento"
			>
				<span aria-hidden="true">＋</span>
				Novo
				<kbd>N</kbd>
			</button>

			{paletteOpen ? (
				<section
					className={styles.panel}
					role="dialog"
					aria-label="Escolher tipo do novo elemento"
				>
					<header>
						<strong>Novo elemento</strong>
						<small>Escolha o tipo e depois clique no mapa.</small>
					</header>
					<div className={styles.typeGrid}>
						{WORLD_DIRECT_CREATE_TYPES.map((type) => (
							<button
								key={type}
								type="button"
								onClick={() => {
									setPaletteOpen(false);
									onSelectType(type);
								}}
							>
								{worldEntityTypeLabel(type)}
							</button>
						))}
					</div>
					<button className={styles.cancelLink} type="button" onClick={() => setPaletteOpen(false)}>
						Fechar
					</button>
				</section>
			) : null}

			{placementType && !placementPoint ? (
				<div className={styles.placement} role="status">
					<span aria-hidden="true">⌖</span>
					<div>
						<strong>Posicione {worldEntityTypeLabel(placementType)}</strong>
						<small>Clique ou toque no canvas. Esc cancela.</small>
					</div>
					<button type="button" onClick={onCancel}>
						Cancelar
					</button>
				</div>
			) : null}

			{placementType && placementPoint ? (
				<form
					className={styles.composer}
					onSubmit={(event) => {
						event.preventDefault();
						if (!name.trim()) return;
						onCreate(name);
						setName("");
					}}
				>
					<label htmlFor="world-direct-create-name">
						<span>{worldEntityTypeLabel(placementType)} no rascunho</span>
						<input
							ref={nameInputRef}
							id="world-direct-create-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="Nome do elemento"
							autoComplete="off"
							required
						/>
					</label>
					<div className={styles.composerActions}>
						<button type="submit" disabled={!name.trim()}>
							Criar
						</button>
						<button type="button" onClick={onCancel}>
							Cancelar
						</button>
					</div>
				</form>
			) : null}
		</div>
	);
}
