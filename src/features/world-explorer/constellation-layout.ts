import type { WorldGraphProjection, WorldNodeDTO } from "./model";

export type WorldPosition = { x: number; y: number };
export type WorldLayout = Record<string, WorldPosition>;

const HERO_RADIUS_X = 290;
const HERO_RADIUS_Y = 215;
const SATELLITE_RADIUS = 245;
const OUTER_RADIUS_X = 610;
const OUTER_RADIUS_Y = 430;

function pointOnEllipse(
	index: number,
	count: number,
	radiusX: number,
	radiusY: number,
	rotation = -Math.PI / 2,
): WorldPosition {
	const angle = rotation + (index / Math.max(count, 1)) * Math.PI * 2;
	return {
		x: Math.round(Math.cos(angle) * radiusX),
		y: Math.round(Math.sin(angle) * radiusY),
	};
}

function nodeStableOrder(left: WorldNodeDTO, right: WorldNodeDTO) {
	return left.label.localeCompare(right.label, "pt-BR");
}

function connectedHero(
	projection: WorldGraphProjection,
	nodeId: string,
	heroIds: readonly string[],
): string | null {
	for (const heroId of heroIds) {
		if (
			projection.edges.some(
				(edge) =>
					(edge.source === heroId && edge.target === nodeId) ||
					(edge.target === heroId && edge.source === nodeId),
			)
		) {
			return heroId;
		}
	}
	return null;
}

/**
 * Produces a deterministic seed for the explorer without declaring one entity
 * as the permanent centre of the campaign. Heroes form the inner constellation;
 * directly connected context fans out around its nearest hero and everything
 * else occupies the outer field. The result is only a starting point: nodes are
 * draggable in the client and their positions are deliberately not narrative data.
 */
export function constellationWorldLayout(
	projection: WorldGraphProjection,
): WorldLayout {
	const layout: WorldLayout = {};
	const visible = new Set(projection.nodes.map((node) => node.id));
	const heroes = projection.heroIds
		.filter((id) => visible.has(id))
		.map((id) => projection.nodes.find((node) => node.id === id))
		.filter((node): node is WorldNodeDTO => Boolean(node));

	if (projection.mode === "focus" && projection.focusId) {
		layout[projection.focusId] = { x: 0, y: 0 };
		const neighbours = projection.nodes
			.filter((node) => node.id !== projection.focusId)
			.sort(nodeStableOrder);
		neighbours.forEach((node, index) => {
			layout[node.id] = pointOnEllipse(index, neighbours.length, 390, 300);
		});
		return applyHints(projection, layout);
	}

	const orderedHeroes = [...heroes].sort(nodeStableOrder);
	orderedHeroes.forEach((hero, index) => {
		layout[hero.id] = pointOnEllipse(
			index,
			orderedHeroes.length,
			HERO_RADIUS_X,
			HERO_RADIUS_Y,
			-Math.PI / 2 + Math.PI / Math.max(orderedHeroes.length, 3),
		);
	});

	const heroIds = orderedHeroes.map((hero) => hero.id);
	const satellites = new Map<string, WorldNodeDTO[]>();
	const unanchored: WorldNodeDTO[] = [];
	for (const node of projection.nodes) {
		if (heroIds.includes(node.id)) continue;
		const anchor = connectedHero(projection, node.id, heroIds);
		if (!anchor) {
			unanchored.push(node);
			continue;
		}
		const group = satellites.get(anchor) ?? [];
		group.push(node);
		satellites.set(anchor, group);
	}

	for (const [heroId, group] of satellites) {
		group.sort(nodeStableOrder);
		const anchor = layout[heroId] ?? { x: 0, y: 0 };
		const outward = Math.atan2(anchor.y, anchor.x);
		const spread = Math.min(Math.PI * 0.9, 0.42 * Math.max(group.length - 1, 1));
		group.forEach((node, index) => {
			const t = group.length === 1 ? 0.5 : index / (group.length - 1);
			const angle = outward - spread / 2 + spread * t;
			const radius = SATELLITE_RADIUS + (index % 2) * 54;
			layout[node.id] = {
				x: Math.round(anchor.x + Math.cos(angle) * radius),
				y: Math.round(anchor.y + Math.sin(angle) * radius),
			};
		});
	}

	unanchored.sort(nodeStableOrder).forEach((node, index) => {
		layout[node.id] = pointOnEllipse(
			index,
			unanchored.length,
			OUTER_RADIUS_X,
			OUTER_RADIUS_Y,
			-Math.PI / 4,
		);
	});

	return applyHints(projection, layout);
}

function applyHints(
	projection: WorldGraphProjection,
	layout: WorldLayout,
): WorldLayout {
	for (const node of projection.nodes) {
		if (node.layoutHint) {
			layout[node.id] = { ...node.layoutHint };
		}
	}
	return layout;
}

export function closestCardinalHandles(
	source: WorldPosition,
	target: WorldPosition,
): { sourceHandle: string; targetHandle: string } {
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	if (Math.abs(dx) >= Math.abs(dy)) {
		return dx >= 0
			? { sourceHandle: "source-right", targetHandle: "target-left" }
			: { sourceHandle: "source-left", targetHandle: "target-right" };
	}
	return dy >= 0
		? { sourceHandle: "source-bottom", targetHandle: "target-top" }
		: { sourceHandle: "source-top", targetHandle: "target-bottom" };
}
