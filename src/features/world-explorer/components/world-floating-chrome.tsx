"use client";

import { useState, type CSSProperties, type ReactNode, type Ref } from "react";
import type {
	WorldFilter,
	WorldPublicationMeta,
	WorldRelationFilter,
	WorldRelationTypeDTO,
} from "../model";
import { worldPublicationVersionLabel } from "../world-publication";
import chrome from "./world-floating-chrome.module.css";
import styles from "./world-explorer.module.css";

const FILTER_OPTIONS: { value: WorldFilter; label: string }[] = [
	{ value: "all", label: "Todos" },
	{ value: "characters", label: "Personagens" },
	{ value: "npcs", label: "NPCs" },
	{ value: "locations", label: "Lugares" },
	{ value: "factions", label: "Facções" },
	{ value: "songs", label: "Músicas" },
	{ value: "moments", label: "Momentos" },
];

const RELATION_OPTIONS: { value: WorldRelationFilter; label: string }[] = [
	{ value: "all", label: "Todas" },
	{ value: "affinity", label: "Afinidade" },
	{ value: "conflict", label: "Conflito" },
	{ value: "family", label: "Família" },
	{ value: "authority", label: "Autoridade" },
	{ value: "faction", label: "Facção" },
	{ value: "mystic", label: "Místico" },
	{ value: "creative", label: "Criativo" },
	{ value: "origin", label: "Origem" },
	{ value: "context", label: "Contexto" },
];

const DEMO_RELATION_LEGEND = [
	{ key: "affinity", label: "Afinidade", family: "affinity" },
	{ key: "conflict", label: "Conflito", family: "conflict" },
	{ key: "family", label: "Família", family: "family" },
	{ key: "authority", label: "Autoridade", family: "authority" },
	{ key: "faction", label: "Facção", family: "faction" },
	{ key: "mystic", label: "Místico", family: "mystic" },
	{ key: "creative", label: "Criativo", family: "creative" },
	{ key: "origin", label: "Origem", family: "origin" },
	{ key: "context", label: "Contexto", family: "context" },
] as const;

type WorldView = "canvas" | "list";

type WorldFloatingChromeProps = Readonly<{
	query: string;
	onQueryChange: (query: string) => void;
	relationFilter: WorldRelationFilter;
	onRelationFilterChange: (filter: WorldRelationFilter) => void;
	view: WorldView;
	onViewChange: (view: WorldView) => void;
	onReset: () => void;
	resetLabel: string;
	resetDisabled?: boolean;
	demo: boolean;
	activeRelationTypes: WorldRelationTypeDTO[];
	searchInputRef?: Ref<HTMLInputElement>;
	conductor?: ReactNode;
}>;

type WorldFilterRailProps = Readonly<{
	filter: WorldFilter;
	onFilterChange: (filter: WorldFilter) => void;
}>;

function filterClass(active: boolean) {
	return `${styles.filterActive && active ? styles.filterActive : ""} ${chrome.filterChip}${active ? ` ${chrome.filterChipActive}` : ""}`.trim();
}

function legendItemStyle(color?: string) {
	return color
		? ({ "--world-relation-color": color } as CSSProperties)
		: undefined;
}

export function WorldFilterRail({
	filter,
	onFilterChange,
}: WorldFilterRailProps) {
	return (
		<div className={chrome.filterOverlay} data-world-filter-overlay>
			<fieldset
				className={`${styles.filters} ${chrome.filterRail}`}
				aria-label="Filtrar o grafo"
				data-testid="world-filter-rail"
			>
				{FILTER_OPTIONS.map((option) => (
					<button
						key={option.value}
						type="button"
						className={filterClass(filter === option.value)}
						aria-pressed={filter === option.value}
						onClick={() => onFilterChange(option.value)}
					>
						{option.label}
					</button>
				))}
			</fieldset>
		</div>
	);
}

type WorldPublicationReceiptProps = Readonly<{
	publication?: WorldPublicationMeta;
}>;

export function WorldPublicationReceipt({
	publication,
}: WorldPublicationReceiptProps) {
	if (!publication) return null;

	return (
		<details
			className={chrome.versionDetails}
			data-testid="world-published-version"
			data-world-canvas-utility="publication"
		>
			<summary
				aria-label={`Versão publicada ${worldPublicationVersionLabel(publication)}`}
				title="Detalhes da versão publicada"
			>
				{worldPublicationVersionLabel(publication)}
			</summary>
			<div className={chrome.versionPopover}>
				<strong>Versão publicada</strong>
				<span>
					Grafo r{publication.graphRevision} · Layout r{publication.layoutRevision}
				</span>
				<span>
					{new Intl.DateTimeFormat("pt-BR", {
						dateStyle: "short",
						timeStyle: "short",
					}).format(new Date(publication.publishedAt))}
				</span>
				{publication.publishedBy ? <span>por {publication.publishedBy}</span> : null}
			</div>
		</details>
	);
}

export function WorldFloatingChrome({
	query,
	onQueryChange,
	relationFilter,
	onRelationFilterChange,
	view,
	onViewChange,
	onReset,
	resetLabel,
	resetDisabled = false,
	demo,
	activeRelationTypes,
	searchInputRef,
	conductor,
}: WorldFloatingChromeProps) {
	const [mobileConductorExpanded, setMobileConductorExpanded] = useState(false);
	const currentRelation =
		RELATION_OPTIONS.find((option) => option.value === relationFilter)?.label ?? "Todas";
	const relationLegend = demo
		? DEMO_RELATION_LEGEND.map((item) => ({ ...item, color: undefined }))
		: activeRelationTypes.map((type) => ({
				key: type.slug,
				label: type.label,
				family: type.family,
				color: type.style.color,
			}));

	return (
		<div className={chrome.root} data-testid="world-floating-chrome">
			<div
				className={`${styles.toolbar} ${chrome.primary}${conductor ? ` ${chrome.primaryWithConductor}` : ""}`}
				data-world-chrome-primary
				data-world-workspace-bar
			>
				<label className={`${styles.searchField} ${chrome.searchSurface}`} data-world-search>
					<span className={styles.srOnly}>Buscar no mundo</span>
					<span className={chrome.searchGlyph} aria-hidden="true">
						⌕
					</span>
					<input
						ref={searchInputRef}
						type="search"
						value={query}
						onChange={(event) => onQueryChange(event.target.value)}
						placeholder="Buscar pessoa, lugar ou memória..."
					/>
				</label>

				{conductor ? (
					<>
						<button
							type="button"
							className={chrome.mobileConductorToggle}
							aria-controls="world-mobile-conductor"
							aria-expanded={mobileConductorExpanded}
							onClick={() =>
								setMobileConductorExpanded((expanded) => !expanded)
							}
						>
							<span aria-hidden="true">✦</span>
							Condução
						</button>
						<div
							id="world-mobile-conductor"
							className={chrome.conductorSlot}
							data-world-conductor-slot
							data-mobile-expanded={
								mobileConductorExpanded ? "true" : "false"
							}
						>
							{conductor}
						</div>
					</>
				) : null}

				<details
					className={chrome.relationMenu}
					data-world-relation-filter
					onKeyDown={(event) => {
						if (event.key !== "Escape" || !event.currentTarget.open) return;
						event.preventDefault();
						event.currentTarget.open = false;
						event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
					}}
				>
					<summary aria-label="Filtrar por relação" title="Filtrar por relação">
						<span>Relações</span>
						<small>{currentRelation}</small>
						<span className={chrome.disclosureGlyph} aria-hidden="true">⌄</span>
					</summary>
					<div className={chrome.relationPopover} data-testid="world-relation-popover">
						<fieldset className={chrome.relationOptions} aria-label="Filtros de relação">
							{RELATION_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									aria-pressed={relationFilter === option.value}
									onClick={(event) => {
										onRelationFilterChange(option.value);
										event.currentTarget.closest("details")?.removeAttribute("open");
									}}
								>
									{option.label}
								</button>
							))}
						</fieldset>

						{relationLegend.length ? (
							<ul
								className={chrome.relationLegendList}
								aria-label={demo ? "Legenda de relações" : "Legenda de tipos de ligação"}
							>
								{relationLegend.map((item) => (
									<li
										key={item.key}
										className={chrome.legendItem}
										data-family={item.family}
										style={legendItemStyle(item.color)}
									>
										<i aria-hidden="true" />
										{item.label}
									</li>
								))}
							</ul>
						) : null}
					</div>
				</details>

				<button
					className={`${styles.resetButton} ${chrome.resetSurface}`}
					type="button"
					data-testid="world-layout-reset"
					data-world-layout-action
					aria-label={resetLabel}
					title={resetLabel}
					disabled={resetDisabled}
					onClick={onReset}
				>
					{resetLabel}
				</button>

				<fieldset className={`${styles.viewToggle} ${chrome.viewSurface}`} data-world-view-toggle>
					<legend className={styles.srOnly}>Modo de visualização</legend>
					<button
						type="button"
						aria-pressed={view === "canvas"}
						aria-label="Canvas"
						title="Canvas"
						onClick={() => onViewChange("canvas")}
					>
						<span className={chrome.viewGlyph} aria-hidden="true">⌘</span>
						<span className={chrome.viewLabel}>Canvas</span>
					</button>
					<button
						type="button"
						aria-pressed={view === "list"}
						aria-label="Lista"
						title="Lista"
						onClick={() => onViewChange("list")}
					>
						<span className={chrome.viewGlyph} aria-hidden="true">☷</span>
						<span className={chrome.viewLabel}>Lista</span>
					</button>
				</fieldset>
			</div>

		</div>
	);
}
