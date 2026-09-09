"use client";

import Image from "next/image";
import { useState } from "react";
import { PublicLink } from "@/components/public-link";
import type { WorldEdgeDTO, WorldGraphProjection, WorldNodeDTO } from "../model";
import { relationLabelFor } from "../projection";
import inspectorStyles from "./world-inspector.module.css";
import styles from "./world-explorer.module.css";

type InspectorConnection = {
	edge: WorldEdgeDTO;
	destination: WorldNodeDTO;
};

type InspectorTab = "overview" | "relations" | "moments";

function nodeTypeLabel(node: WorldNodeDTO): string {
	if (node.kind === "moment") return "Momento";
	switch (node.entityType) {
		case "pc":
			return "Herói / personagem";
		case "npc":
			return "NPC";
		case "location":
			return "Lugar";
		case "faction":
		case "organization":
			return "Facção / organização";
		case "song":
			return "Música";
		default:
			return "Entidade";
	}
}

export function WorldInspectorContent({
	selected,
	projection,
	focus,
	onSelect,
	editing,
}: {
	selected: WorldNodeDTO;
	projection: WorldGraphProjection;
	focus?: WorldNodeDTO;
	onSelect: (id: string) => void;
	editing: boolean;
}) {
	const [tab, setTab] = useState<InspectorTab>("overview");
	const relation =
		focus && selected.id !== focus.id
			? relationLabelFor(projection, selected.id, focus.id)
			: null;
	const nodeById = new Map(projection.nodes.map((node) => [node.id, node]));
	const connections: InspectorConnection[] = projection.edges
		.flatMap((edge) => {
			if (edge.source !== selected.id && edge.target !== selected.id) return [];
			const destinationId = edge.source === selected.id ? edge.target : edge.source;
			const destination = nodeById.get(destinationId);
			return destination ? [{ edge, destination }] : [];
		})
		.sort((left, right) =>
			left.destination.label.localeCompare(right.destination.label, "pt-BR"),
		);
	const moments = connections.filter(({ destination }) => destination.kind === "moment");
	const characterConnections = connections.filter(
		({ destination }) =>
			destination.kind === "entity" &&
			(destination.entityType === "pc" || destination.entityType === "npc"),
	);
	const contextualConnections = connections.length - characterConnections.length;
	const tabs: Array<{ id: InspectorTab; label: string; count?: number }> = [
		{ id: "overview", label: "Visão geral" },
		{ id: "relations", label: "Laços", count: connections.length },
		...(moments.length
			? [{ id: "moments" as const, label: "Momentos", count: moments.length }]
			: []),
	];

	return (
		<>
			<div className={styles.inspectorHero} aria-hidden="true">
				{selected.imageUrl ? (
					<Image
						className={styles.inspectorImage}
						src={selected.imageUrl}
						alt=""
						fill
						sizes="520px"
					/>
				) : (
					<span className={styles.inspectorInitial}>
						{selected.label.slice(0, 1).toLocaleUpperCase("pt-BR")}
					</span>
				)}
			</div>
			<p className={styles.eyebrow}>{nodeTypeLabel(selected)}</p>
			<h2>{selected.label}</h2>
			{selected.subtitle ? (
				<p className={styles.inspectorSubtitle}>{selected.subtitle}</p>
			) : null}

			<div
				className={inspectorStyles.tabs}
				role="tablist"
				aria-label={`Detalhes de ${selected.label}`}
			>
				{tabs.map((item) => (
					<button
						key={item.id}
						type="button"
						role="tab"
						aria-selected={tab === item.id}
						aria-controls={`world-inspector-panel-${selected.id}-${item.id}`}
						onClick={() => setTab(item.id)}
					>
						{item.label}
						{typeof item.count === "number" ? <span>{item.count}</span> : null}
					</button>
				))}
			</div>

			{tab === "overview" ? (
				<section
					className={inspectorStyles.tabPanel}
					id={`world-inspector-panel-${selected.id}-overview`}
					role="tabpanel"
					data-inspector-tab="overview"
				>
					{selected.id === projection.focusId ? (
						<p className={styles.focusNote}>Foco exploratório atual.</p>
					) : relation && focus ? (
						<p className={styles.relationSummary}>
							Relação com {focus.label}: {relation}.
						</p>
					) : null}
					<p className={styles.inspectorCopy}>
						Selecionar apenas inspeciona. Você pode percorrer os laços sem reorganizar o mapa
						ou abrir um foco explícito quando quiser estudar só esse núcleo narrativo.
					</p>
					<dl className={inspectorStyles.summaryStats}>
						<div>
							<dt>Laços</dt>
							<dd>{connections.length}</dd>
						</div>
						<div>
							<dt>Personagens</dt>
							<dd>{characterConnections.length}</dd>
						</div>
						<div>
							<dt>Contextos</dt>
							<dd>{contextualConnections}</dd>
						</div>
					</dl>
					{connections.length ? (
						<div className={inspectorStyles.overviewRelations}>
							<h3>Relações em destaque</h3>
							<ConnectionList connections={connections.slice(0, 4)} onSelect={onSelect} />
						</div>
					) : null}
				</section>
			) : null}

			{tab === "relations" ? (
				<section
					className={inspectorStyles.tabPanel}
					id={`world-inspector-panel-${selected.id}-relations`}
					role="tabpanel"
					data-inspector-tab="relations"
				>
					<div className={inspectorStyles.connectionsHeader}>
						<div>
							<p className={inspectorStyles.sectionEyebrow}>Teia visível</p>
							<h3>Conexões de {selected.label}</h3>
						</div>
						<span>{connections.length}</span>
					</div>
					{connections.length ? (
						<ConnectionList connections={connections} onSelect={onSelect} />
					) : (
						<p className={inspectorStyles.connectionsEmpty}>
							Nenhuma conexão permanece visível com os filtros atuais.
						</p>
					)}
				</section>
			) : null}

			{tab === "moments" ? (
				<section
					className={inspectorStyles.tabPanel}
					id={`world-inspector-panel-${selected.id}-moments`}
					role="tabpanel"
					data-inspector-tab="moments"
				>
					<div className={inspectorStyles.connectionsHeader}>
						<div>
							<p className={inspectorStyles.sectionEyebrow}>Memória conectada</p>
							<h3>Momentos visíveis</h3>
						</div>
						<span>{moments.length}</span>
					</div>
					<ConnectionList connections={moments} onSelect={onSelect} />
				</section>
			) : null}

			{editing ? (
				<p className={styles.focusNote}>
					Finalize ou descarte a edição do layout antes de sair deste mapa.
				</p>
			) : (
				<div className={inspectorStyles.actions}>
					{selected.slug && selected.id !== projection.focusId ? (
						<PublicLink
							className={styles.focusAction}
							href={`/mundo?foco=${encodeURIComponent(selected.slug)}`}
						>
							Explorar conexões de {selected.label}
						</PublicLink>
					) : projection.mode === "focus" ? (
						<PublicLink className={styles.focusAction} href="/mundo">
							Voltar à visão geral
						</PublicLink>
					) : null}
					{selected.route ? (
						<PublicLink className={styles.profileAction} href={selected.route}>
							Ver perfil completo
						</PublicLink>
					) : null}
				</div>
			)}
		</>
	);
}

function ConnectionList({
	connections,
	onSelect,
}: {
	connections: InspectorConnection[];
	onSelect: (id: string) => void;
}) {
	return (
		<ul className={inspectorStyles.connectionList}>
			{connections.map(({ edge, destination }) => (
				<li key={edge.id}>
					<button
						type="button"
						data-family={edge.family}
						onClick={() => onSelect(destination.id)}
						aria-label={`Selecionar ${destination.label}; relação ${edge.label}`}
					>
						<span className={inspectorStyles.connectionCopy}>
							<strong>{destination.label}</strong>
							<small>{nodeTypeLabel(destination)}</small>
						</span>
						<span className={inspectorStyles.relationBadge} data-family={edge.family}>
							{edge.label}
						</span>
						<span className={inspectorStyles.connectionArrow} aria-hidden="true">
							›
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

export function WorldAccessibleRelations({
	projection,
	selectedId,
	onSelect,
	compact,
}: {
	projection: WorldGraphProjection;
	selectedId: string | null;
	onSelect: (id: string) => void;
	compact: boolean;
}) {
	const nodeById = new Map(projection.nodes.map((node) => [node.id, node]));
	const relations = selectedId
		? projection.edges.filter(
				(edge) => edge.source === selectedId || edge.target === selectedId,
			)
		: projection.edges;
	return (
		<section
			className={`${styles.relationList} ${compact ? styles.relationListCompact : ""}`}
			aria-labelledby="world-relations-title"
		>
			<h2 id="world-relations-title">Relações em lista</h2>
			<p>
				{selectedId
					? "Laços visíveis da seleção atual."
					: "Alternativa textual ao canvas completo."}
			</p>
			{relations.length > 0 ? (
				<ul>
					{relations.map((edge) => {
						const source = nodeById.get(edge.source);
						const target = nodeById.get(edge.target);
						const destination = selectedId === edge.source ? target : source;
						return (
							<li key={edge.id}>
								<button
									type="button"
									onClick={() => destination && onSelect(destination.id)}
								>
									<strong>
										{source?.label ?? edge.source} ↔ {target?.label ?? edge.target}
									</strong>
									<span className={styles.relationLabelText}>{edge.label}</span>
								</button>
							</li>
						);
					})}
				</ul>
			) : (
				<p>Nenhuma relação visível para os filtros atuais.</p>
			)}
		</section>
	);
}
