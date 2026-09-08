"use client";

import type { Viewport } from "@xyflow/react";
import type { WorldFlowEdge, WorldFlowNode } from "../adapters/react-flow";
import type { WorldNodeProminence, WorldRelationFamily } from "../model";
import styles from "./world-explorer.module.css";

const RELATION_STROKES: Record<WorldRelationFamily, string> = {
	affinity: "#65c98a",
	family: "#e4b455",
	conflict: "#ef5c58",
	authority: "#8f9aa8",
	faction: "#8f9aa8",
	origin: "#6caee8",
	mystic: "#a97df2",
	creative: "#f0a14d",
	context: "#8f9aa8",
};

const RELATION_DASHES: Partial<Record<WorldRelationFamily, string>> = {
	conflict: "9 7",
	mystic: "3 7",
	origin: "11 6",
};

const NODE_RADIUS: Record<WorldNodeProminence, number> = {
	hero: 62,
	primary: 48,
	supporting: 42,
	context: 34,
};

type Point = { x: number; y: number };

type PaintedRelation = {
	id: string;
	path: string;
	family: WorldRelationFamily;
	highlighted: boolean;
	dimmed: boolean;
	directed: boolean;
};

function toScreen(point: Point, viewport: Viewport): Point {
	return {
		x: viewport.x + point.x * viewport.zoom,
		y: viewport.y + point.y * viewport.zoom,
	};
}

function trimSegment(
	source: Point,
	target: Point,
	sourceRadius: number,
	targetRadius: number,
) {
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const distance = Math.hypot(dx, dy);
	if (distance < 1) return { source, target };
	const ux = dx / distance;
	const uy = dy / distance;
	const safeSourceRadius = Math.min(sourceRadius, distance * 0.28);
	const safeTargetRadius = Math.min(targetRadius, distance * 0.28);
	return {
		source: {
			x: source.x + ux * safeSourceRadius,
			y: source.y + uy * safeSourceRadius,
		},
		target: {
			x: target.x - ux * safeTargetRadius,
			y: target.y - uy * safeTargetRadius,
		},
	};
}

function stableCurve(
	edgeId: string,
	source: Point,
	target: Point,
	routeOffset: number,
): string {
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const distance = Math.max(Math.hypot(dx, dy), 1);
	const normalX = -dy / distance;
	const normalY = dx / distance;
	let hash = 0;
	for (let index = 0; index < edgeId.length; index += 1) {
		hash = (hash * 31 + edgeId.charCodeAt(index)) >>> 0;
	}
	const direction = hash % 2 === 0 ? 1 : -1;
	const bend = Math.min(44, Math.max(10, routeOffset * 0.55)) * direction;
	const c1 = {
		x: source.x + dx * 0.34 + normalX * bend,
		y: source.y + dy * 0.34 + normalY * bend,
	};
	const c2 = {
		x: source.x + dx * 0.66 + normalX * bend,
		y: source.y + dy * 0.66 + normalY * bend,
	};
	return `M ${source.x.toFixed(2)} ${source.y.toFixed(2)} C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)}, ${c2.x.toFixed(2)} ${c2.y.toFixed(2)}, ${target.x.toFixed(2)} ${target.y.toFixed(2)}`;
}

function paintRelations(
	nodes: readonly WorldFlowNode[],
	edges: readonly WorldFlowEdge[],
	viewport: Viewport,
): PaintedRelation[] {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	return edges.flatMap((edge) => {
		const sourceNode = byId.get(edge.source);
		const targetNode = byId.get(edge.target);
		if (!sourceNode || !targetNode) return [];

		const source = toScreen(sourceNode.position, viewport);
		const target = toScreen(targetNode.position, viewport);
		const sourceRadius = NODE_RADIUS[sourceNode.data.prominence] * viewport.zoom;
		const targetRadius = NODE_RADIUS[targetNode.data.prominence] * viewport.zoom;
		const trimmed = trimSegment(source, target, sourceRadius, targetRadius);
		const family = edge.data?.family ?? "context";
		return [
			{
				id: edge.id,
				path: stableCurve(
					edge.id,
					trimmed.source,
					trimmed.target,
					edge.data?.routeOffset ?? 28,
				),
				family,
				highlighted: edge.data?.isHighlighted ?? false,
				dimmed: edge.data?.isDimmed ?? false,
				directed: edge.data?.item.direction === "directed",
			},
		];
	});
}

export function WorldRelationOverlay({
	nodes,
	edges,
	viewport,
}: {
	nodes: readonly WorldFlowNode[];
	edges: readonly WorldFlowEdge[];
	viewport: Viewport;
}) {
	const relations = paintRelations(nodes, edges, viewport);
	return (
		<svg
			className={styles.relationOverlay}
			data-testid="world-relation-overlay"
			aria-hidden="true"
		>
			<defs>
				{Object.entries(RELATION_STROKES).map(([family, color]) => (
					<marker
						key={family}
						id={`world-relation-arrow-${family}`}
						markerWidth="8"
						markerHeight="8"
						refX="7"
						refY="4"
						orient="auto"
						markerUnits="strokeWidth"
					>
						<path d="M 0 0 L 8 4 L 0 8 z" fill={color} />
					</marker>
				))}
			</defs>
			{relations.map((relation) => {
				const color = RELATION_STROKES[relation.family];
				const width = relation.highlighted ? 4.6 : 3.3;
				const opacity = relation.dimmed
					? 0.18
					: relation.highlighted
						? 1
						: 0.98;
				const dash = RELATION_DASHES[relation.family];
				return (
					<g key={relation.id}>
						<path
							d={relation.path}
							fill="none"
							stroke="var(--ds-canvas)"
							strokeWidth={width + 5}
							strokeOpacity={relation.dimmed ? 0.08 : 0.9}
							strokeDasharray={dash}
							strokeLinecap="round"
							strokeLinejoin="round"
							vectorEffect="non-scaling-stroke"
						/>
						<path
							d={relation.path}
							fill="none"
							stroke={color}
							strokeWidth={width}
							strokeOpacity={opacity}
							strokeDasharray={dash}
							strokeLinecap="round"
							strokeLinejoin="round"
							vectorEffect="non-scaling-stroke"
							markerEnd={
								relation.directed
									? `url(#world-relation-arrow-${relation.family})`
									: undefined
							}
							data-world-edge-visual={relation.id}
							data-family={relation.family}
						/>
					</g>
				);
			})}
		</svg>
	);
}
