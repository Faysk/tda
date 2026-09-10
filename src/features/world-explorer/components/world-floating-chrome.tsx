"use client";

import type { CSSProperties } from "react";
import { Select } from "@/components/ui";
import type {
	WorldFilter,
	WorldRelationFilter,
	WorldRelationTypeDTO,
} from "../model";
import styles from "./world-explorer.module.css";
import responsive from "./world-responsive.module.css";

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
	{ value: "all", label: "Todas as relações" },
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

type WorldView = "canvas" | "list";

type WorldFloatingChromeProps = Readonly<{
	query: string;
	onQueryChange: (query: string) => void;
	filter: WorldFilter;
	onFilterChange: (filter: WorldFilter) => void;
	relationFilter: WorldRelationFilter;
	onRelationFilterChange: (filter: WorldRelationFilter) => void;
	view: WorldView;
	onViewChange: (view: WorldView) => void;
	onReset: () => void;
	resetLabel: string;
	resetDisabled?: boolean;
	demo: boolean;
	activeRelationTypes: WorldRelationTypeDTO[];
}>;

export function WorldFloatingChrome({
	query,
	onQueryChange,
	filter,
	onFilterChange,
	relationFilter,
	onRelationFilterChange,
	view,
	onViewChange,
	onReset,
	resetLabel,
	resetDisabled = false,
	demo,
	activeRelationTypes,
}: WorldFloatingChromeProps) {
	return (
		<div className={styles.floatingChrome} data-testid="world-floating-chrome">
			<div className={`${styles.toolbar} ${responsive.toolbar} ${styles.chromePrimary}`}>
				<label className={`${styles.searchField} ${responsive.search}`}>
					<span className={styles.srOnly}>Buscar no mundo</span>
					<span className={styles.searchGlyph} aria-hidden="true">
						⌕
					</span>
					<input
						type="search"
						value={query}
						onChange={(event) => onQueryChange(event.target.value)}
						placeholder="Buscar pessoa, lugar ou memória..."
					/>
				</label>

				<div className={`${styles.relationSelect} ${responsive.relation}`}>
					<span>Relação</span>
					<Select
						value={relationFilter}
						options={RELATION_OPTIONS}
						onChange={onRelationFilterChange}
						ariaLabel="Filtrar por relação"
						embedded
					/>
				</div>

				<button
					className={`${styles.resetButton} ${responsive.reset}`}
					type="button"
					disabled={resetDisabled}
					onClick={onReset}
				>
					{resetLabel}
				</button>

				<fieldset className={styles.viewToggle}>
					<legend className={styles.srOnly}>Modo de visualização</legend>
					<button
						type="button"
						aria-pressed={view === "canvas"}
						aria-label="Canvas"
						title="Canvas"
						onClick={() => onViewChange("canvas")}
					>
						<span className={styles.viewGlyph} aria-hidden="true">
							⌘
						</span>
						<span className={styles.viewLabel}>Canvas</span>
					</button>
					<button
						type="button"
						aria-pressed={view === "list"}
						aria-label="Lista"
						title="Lista"
						onClick={() => onViewChange("list")}
					>
						<span className={styles.viewGlyph} aria-hidden="true">
							☷
						</span>
						<span className={styles.viewLabel}>Lista</span>
					</button>
				</fieldset>
			</div>

			<div className={styles.chromeSecondary}>
				<fieldset className={styles.filters} aria-label="Filtrar o grafo">
					{FILTER_OPTIONS.map((option) => (
						<button
							key={option.value}
							type="button"
							className={filter === option.value ? styles.filterActive : undefined}
							aria-pressed={filter === option.value}
							onClick={() => onFilterChange(option.value)}
						>
							{option.label}
						</button>
					))}
				</fieldset>

				{demo ? (
					<fieldset className={styles.relationLegend}>
						<legend className={styles.srOnly}>Legenda de relações</legend>
						<span data-family="affinity">Afinidade</span>
						<span data-family="conflict">Conflito</span>
						<span data-family="family">Família</span>
						<span data-family="mystic">Místico</span>
						<span data-family="creative">Criativo</span>
					</fieldset>
				) : activeRelationTypes.length ? (
					<fieldset className={styles.relationLegend}>
						<legend className={styles.srOnly}>Legenda de tipos de ligação</legend>
						{activeRelationTypes.map((type) => (
							<span
								key={type.slug}
								data-family={type.family}
								style={{ "--world-relation-color": type.style.color } as CSSProperties}
							>
								{type.label}
							</span>
						))}
					</fieldset>
				) : null}
			</div>
		</div>
	);
}
