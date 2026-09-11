"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorldNodeDTO } from "../model";
import {
	availableWorldCommands,
	type WorldCommandContext,
	type WorldCommandDefinition,
	type WorldCommandId,
} from "../world-commands";
import styles from "./world-command-palette.module.css";

type PaletteResult =
	| Readonly<{ kind: "command"; key: string; command: WorldCommandDefinition }>
	| Readonly<{ kind: "entity"; key: string; entity: WorldNodeDTO }>;

function normalizeSearch(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLocaleLowerCase("pt-BR")
		.trim();
}

function commandSearchText(command: WorldCommandDefinition): string {
	return `${command.label} ${command.group} ${command.shortcut ?? ""}`;
}

function entitySearchText(entity: WorldNodeDTO): string {
	return `${entity.label} ${entity.subtitle ?? ""} ${entity.entityType ?? ""}`;
}

function shortcutLabel(shortcut: WorldCommandDefinition["shortcut"]): string | null {
	if (!shortcut) return null;
	return shortcut === "Mod+K" ? "⌘/Ctrl K" : shortcut;
}

export function WorldCommandPalette({
	open,
	context,
	entities,
	commandIds,
	onClose,
	onCommand,
	onSelectEntity,
}: Readonly<{
	open: boolean;
	context: WorldCommandContext;
	entities: readonly WorldNodeDTO[];
	commandIds: ReadonlySet<WorldCommandId>;
	onClose: () => void;
	onCommand: (id: WorldCommandId) => void;
	onSelectEntity: (id: string) => void;
}>) {
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const results = useMemo<PaletteResult[]>(() => {
		const needle = normalizeSearch(query);
		const commands = availableWorldCommands(context)
			.filter((command) => commandIds.has(command.id))
			.filter((command) => command.id !== "world.openCommandPalette")
			.filter(
				(command) =>
					!needle || normalizeSearch(commandSearchText(command)).includes(needle),
			)
			.slice(0, 10)
			.map((command) => ({
				kind: "command" as const,
				key: `command:${command.id}`,
				command,
			}));
		const matchingEntities = entities
			.filter(
				(entity) =>
					!needle || normalizeSearch(entitySearchText(entity)).includes(needle),
			)
			.slice(0, 10)
			.map((entity) => ({
				kind: "entity" as const,
				key: `entity:${entity.id}`,
				entity,
			}));
		return [...commands, ...matchingEntities];
	}, [commandIds, context, entities, query]);

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setActiveIndex(0);
		const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
		return () => window.cancelAnimationFrame(frame);
	}, [open]);

	useEffect(() => {
		setActiveIndex((current) => Math.min(current, Math.max(results.length - 1, 0)));
	}, [results.length]);

	if (!open) return null;

	function activate(result: PaletteResult | undefined) {
		if (!result) return;
		if (result.kind === "command") {
			onClose();
			onCommand(result.command.id);
			return;
		}
		onClose();
		onSelectEntity(result.entity.id);
	}

	return (
		<div
			className={styles.backdrop}
			data-world-command-palette
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<section
				className={styles.palette}
				role="dialog"
				aria-modal="true"
				aria-labelledby="world-command-palette-title"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						onClose();
						return;
					}
					if (event.key === "ArrowDown") {
						event.preventDefault();
						setActiveIndex((current) =>
							results.length ? (current + 1) % results.length : 0,
						);
						return;
					}
					if (event.key === "ArrowUp") {
						event.preventDefault();
						setActiveIndex((current) =>
							results.length ? (current - 1 + results.length) % results.length : 0,
						);
						return;
					}
					if (event.key === "Enter") {
						event.preventDefault();
						activate(results[activeIndex]);
					}
				}}
			>
				<header className={styles.header}>
					<div>
						<span>World Authoring</span>
						<h2 id="world-command-palette-title">Comandos do Mundo</h2>
					</div>
					<kbd>Esc</kbd>
				</header>

				<label className={styles.search}>
					<span aria-hidden="true">⌕</span>
					<span className={styles.srOnly}>Buscar comandos ou elementos</span>
					<input
						ref={inputRef}
						type="search"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActiveIndex(0);
						}}
						placeholder="Comando, personagem, lugar..."
						autoComplete="off"
						aria-controls="world-command-palette-results"
						aria-activedescendant={results[activeIndex]?.key ?? undefined}
					/>
				</label>

				<div
					className={styles.results}
					id="world-command-palette-results"
					role="listbox"
					aria-label="Resultados dos comandos"
				>
					{results.length ? (
						results.map((result, index) => {
							const active = index === activeIndex;
							if (result.kind === "command") {
								return (
									<button
										key={result.key}
										id={result.key}
										type="button"
										role="option"
										aria-selected={active}
										data-active={active ? "true" : "false"}
										onMouseEnter={() => setActiveIndex(index)}
										onClick={() => activate(result)}
									>
										<span className={styles.resultIcon} aria-hidden="true">⌘</span>
										<span className={styles.resultCopy}>
											<strong>{result.command.label}</strong>
											<small>{result.command.group}</small>
										</span>
										{shortcutLabel(result.command.shortcut) ? (
											<kbd>{shortcutLabel(result.command.shortcut)}</kbd>
										) : null}
									</button>
								);
							}
							return (
								<button
									key={result.key}
									id={result.key}
									type="button"
									role="option"
									aria-selected={active}
									data-active={active ? "true" : "false"}
									onMouseEnter={() => setActiveIndex(index)}
									onClick={() => activate(result)}
								>
									<span className={styles.resultIcon} aria-hidden="true">◇</span>
									<span className={styles.resultCopy}>
										<strong>{result.entity.label}</strong>
										<small>{result.entity.subtitle ?? result.entity.entityType ?? "Elemento"}</small>
									</span>
									<span className={styles.entityHint}>Selecionar</span>
								</button>
							);
						})
					) : (
						<p className={styles.empty}>Nenhum comando ou elemento encontrado.</p>
					)}
				</div>

				<footer className={styles.footer}>
					<span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
					<span><kbd>Enter</kbd> executar</span>
				</footer>
			</section>
		</div>
	);
}
