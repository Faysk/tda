import type { WorldGraphProjection, WorldNodeDTO } from "./model";

export type WorldPosition = { x: number; y: number };
export type WorldLayout = Record<string, WorldPosition>;

const HERO_RADIUS_X = 290;
const HERO_RADIUS_Y = 215;
const SATELLITE_RADIUS = 245;
const SATELLITE_DEPTH_STEP = 118;
const SHARED_CLUSTER_SPACING = 96;
const OUTER_RADIUS_X = 610;
const OUTER_RADIUS_Y = 430;
const MAX_AFFINITY_DEPTH = 4;

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

function buildAdjacency(projection: WorldGraphProjection): Map<string, Set<string>> {
	const adjacency = new Map<string, Set<string>>();
	for (const node of projection.nodes) adjacency.set(node.id, new Set());
	for (const edge of projection.edges) {
		if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
		adjacency.get(edge.source)?.add(edge.target);
		adjacency.get(edge.target)?.add(edge.source);
	}
	return adjacency;
}

type HeroAffinity = {
	heroIds: string[];
	distance: number;
};

function nearestHeroAffinity(
	adjacency: ReadonlyMap<string, ReadonlySet<string>>,
	nodeId: string,
	heroIds: readonly string[],
): HeroAffinity | null {
	const heroSet = new Set(heroIds);
	const visited = new Set<string>([nodeId]);
	let frontier = [nodeId];

	for (let distance = 1; distance <= MAX_AFFINITY_DEPTH; distance += 1) {
		const next: string[] = [];
		const matches = new Set<string>();
		for (const current of frontier) {
			for (const neighbour of adjacency.get(current) ?? []) {
				if (visited.has(neighbour)) continue;
				visited.add(neighbour);
				if (heroSet.has(neighbour)) {
					matches.add(neighbour);
					continue;
				}
				next.push(neighbour);
			}
		}
		if (matches.size > 0) {
			return {
				heroIds: [...matches].sort((left, right) => left.localeCompare(right)),
				distance,
			};
		}
		if (next.length === 0) break;
		frontier = next;
	}

	return null;
}

function averagePosition(ids: readonly string[], layout: WorldLayout): WorldPosition {
	const positions = ids
		.map((id) => layout[id])
		.filter((position): position is WorldPosition => Boolean(position));
	if (positions.length === 0) return { x: 0, y: 0 };
	return {
		x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
		y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
	};
}

function stableSignatureAngle(signature: string): number {
	let hash = 0;
	for (const character of signature) {
		const codePoint = character.codePointAt(0) ?? 0;
		hash = (hash * 31 + codePoint) >>> 0;
	}
	return ((hash % 360) / 180) * Math.PI;
}

/**
 * Produces a deterministic seed for the explorer without declaring one entity
 * as the permanent centre of the campaign. Heroes form the inner constellation;
 * context follows the nearest hero topology instead of the first matching edge,
 * shared context is placed between peer hubs, and disconnected material occupies
 * the outer field. The result remains presentation-only and draggable.
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
	const adjacency = buildAdjacency(projection);
	const satellites = new Map<string, { node: WorldNodeDTO; distance: number }[]>();
	const shared = new Map<string, { heroIds: string[]; nodes: WorldNodeDTO[] }>();
	const unanchored: WorldNodeDTO[] = [];

	for (const node of projection.nodes) {
		if (heroIds.includes(node.id)) continue;
		const affinity = nearestHeroAffinity(adjacency, node.id, heroIds);
		if (!affinity) {
			unanchored.push(node);
			continue;
		}
		if (affinity.heroIds.length === 1) {
			const [heroId] = affinity.heroIds;
			const group = satellites.get(heroId) ?? [];
			group.push({ node, distance: affinity.distance });
			satellites.set(heroId, group);
			continue;
		}

		const signature = affinity.heroIds.join("|");
		const group = shared.get(signature) ?? {
			heroIds: affinity.heroIds,
			nodes: [],
		};
		group.nodes.push(node);
		shared.set(signature, group);
	}

	for (const [heroId, group] of satellites) {
		group.sort((left, right) =>
			left.distance === right.distance
				? nodeStableOrder(left.node, right.node)
				: left.distance - right.distance,
		);
		const anchor = layout[heroId] ?? { x: 0, y: 0 };
		const outward = Math.atan2(anchor.y, anchor.x);
		const spread = Math.min(Math.PI * 0.9, 0.42 * Math.max(group.length - 1, 1));
		group.forEach(({ node, distance }, index) => {
			const t = group.length === 1 ? 0.5 : index / (group.length - 1);
			const angle = outward - spread / 2 + spread * t;
			const radius =
				SATELLITE_RADIUS + (distance - 1) * SATELLITE_DEPTH_STEP + (index % 2) * 54;
			layout[node.id] = {
				x: Math.round(anchor.x + Math.cos(angle) * radius),
				y: Math.round(anchor.y + Math.sin(angle) * radius),
			};
		});
	}

	for (const [signature, group] of shared) {
		group.nodes.sort(nodeStableOrder);
		const centroid = averagePosition(group.heroIds, layout);
		const first = layout[group.heroIds[0]];
		const second = layout[group.heroIds[1]];
		const axisAngle =
			first && second
				? Math.atan2(second.y - first.y, second.x - first.x) + Math.PI / 2
				: stableSignatureAngle(signature);
		const centreOffset = (group.nodes.length - 1) / 2;
		group.nodes.forEach((node, index) => {
			const lane = index - centreOffset;
			const offset = lane * SHARED_CLUSTER_SPACING;
			layout[node.id] = {
				x: Math.round(centroid.x + Math.cos(axisAngle) * offset),
				y: Math.round(centroid.y + Math.sin(axisAngle) * offset),
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
