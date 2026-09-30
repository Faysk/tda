import type { WorldLayout, WorldPosition } from "./constellation-layout";
import type { WorldEdgeDTO } from "./model";

export type WorldRouteBends = Readonly<Record<string, number>>;
export type WorldRoutePolyline = readonly [
	WorldPosition,
	WorldPosition,
	WorldPosition,
];

const NODE_CLEARANCE = 64;
const CROSSING_PENALTY = 1_000;
const NODE_PROXIMITY_PENALTY = 4;
const BEND_PENALTY = 0.5;
const EPSILON = 1e-7;

function stableHash(value: string): number {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
	}
	return hash;
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}

function orientation(a: WorldPosition, b: WorldPosition, c: WorldPosition): number {
	return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(
	a: WorldPosition,
	b: WorldPosition,
	point: WorldPosition,
): boolean {
	if (Math.abs(orientation(a, b, point)) > EPSILON) return false;
	return (
		point.x >= Math.min(a.x, b.x) - EPSILON &&
		point.x <= Math.max(a.x, b.x) + EPSILON &&
		point.y >= Math.min(a.y, b.y) - EPSILON &&
		point.y <= Math.max(a.y, b.y) + EPSILON
	);
}

function segmentsIntersect(
	a: WorldPosition,
	b: WorldPosition,
	c: WorldPosition,
	d: WorldPosition,
): boolean {
	const o1 = orientation(a, b, c);
	const o2 = orientation(a, b, d);
	const o3 = orientation(c, d, a);
	const o4 = orientation(c, d, b);

	if (o1 * o2 < -EPSILON && o3 * o4 < -EPSILON) return true;
	return (
		(Math.abs(o1) <= EPSILON && pointOnSegment(a, b, c)) ||
		(Math.abs(o2) <= EPSILON && pointOnSegment(a, b, d)) ||
		(Math.abs(o3) <= EPSILON && pointOnSegment(c, d, a)) ||
		(Math.abs(o4) <= EPSILON && pointOnSegment(c, d, b))
	);
}

function polylineCrossings(
	left: WorldRoutePolyline,
	right: WorldRoutePolyline,
): number {
	let crossings = 0;
	for (let leftIndex = 0; leftIndex < 2; leftIndex += 1) {
		for (let rightIndex = 0; rightIndex < 2; rightIndex += 1) {
			if (
				segmentsIntersect(
					left[leftIndex],
					left[leftIndex + 1],
					right[rightIndex],
					right[rightIndex + 1],
				)
			) {
				crossings += 1;
			}
		}
	}
	return crossings;
}

function pointToSegmentDistance(
	point: WorldPosition,
	start: WorldPosition,
	end: WorldPosition,
): number {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared <= EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
	const t = clamp(
		((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
		0,
		1,
	);
	const x = start.x + dx * t;
	const y = start.y + dy * t;
	return Math.hypot(point.x - x, point.y - y);
}

function polylinePointDistance(
	point: WorldPosition,
	path: WorldRoutePolyline,
): number {
	return Math.min(
		pointToSegmentDistance(point, path[0], path[1]),
		pointToSegmentDistance(point, path[1], path[2]),
	);
}

function sharesEndpoint(left: WorldEdgeDTO, right: WorldEdgeDTO): boolean {
	return (
		left.source === right.source ||
		left.source === right.target ||
		left.target === right.source ||
		left.target === right.target
	);
}

export function worldEdgeRoutePolyline(
	layout: Readonly<WorldLayout>,
	edge: WorldEdgeDTO,
	bendOffset: number,
): WorldRoutePolyline | null {
	const source = layout[edge.source];
	const target = layout[edge.target];
	if (!source || !target) return null;

	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const distance = Math.hypot(dx, dy);
	if (distance <= EPSILON) {
		return [
			source,
			{ x: source.x + bendOffset, y: source.y },
			target,
		];
	}

	const normalX = -dy / distance;
	const normalY = dx / distance;
	return [
		source,
		{
			x: (source.x + target.x) / 2 + normalX * bendOffset,
			y: (source.y + target.y) / 2 + normalY * bendOffset,
		},
		target,
	];
}

export function countWorldRouteCrossings(
	layout: Readonly<WorldLayout>,
	edges: readonly WorldEdgeDTO[],
	bends: WorldRouteBends,
): number {
	let crossings = 0;
	for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
		const left = edges[leftIndex];
		if (!left) continue;
		const leftPath = worldEdgeRoutePolyline(layout, left, bends[left.id] ?? 0);
		if (!leftPath) continue;
		for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex += 1) {
			const right = edges[rightIndex];
			if (!right || sharesEndpoint(left, right)) continue;
			const rightPath = worldEdgeRoutePolyline(layout, right, bends[right.id] ?? 0);
			if (!rightPath) continue;
			crossings += polylineCrossings(leftPath, rightPath);
		}
	}
	return crossings;
}

function candidateBends(edgeId: string, distance: number): number[] {
	const small = clamp(distance * 0.16, 28, 72);
	const large = clamp(distance * 0.58, 72, 220);
	const sign = stableHash(edgeId) % 2 === 0 ? 1 : -1;
	return [0, sign * small, -sign * small, sign * large, -sign * large];
}

function routeScore(
	layout: Readonly<WorldLayout>,
	edge: WorldEdgeDTO,
	path: WorldRoutePolyline,
	bendOffset: number,
	accepted: ReadonlyArray<{ edge: WorldEdgeDTO; path: WorldRoutePolyline }>,
): number {
	let score = Math.abs(bendOffset) * BEND_PENALTY;

	for (const route of accepted) {
		if (sharesEndpoint(edge, route.edge)) continue;
		score += polylineCrossings(path, route.path) * CROSSING_PENALTY;
	}

	for (const [nodeId, position] of Object.entries(layout)) {
		if (nodeId === edge.source || nodeId === edge.target) continue;
		const distance = polylinePointDistance(position, path);
		if (distance < NODE_CLEARANCE) {
			score += (NODE_CLEARANCE - distance) * NODE_PROXIMITY_PENALTY;
		}
	}

	return score;
}

/**
 * Picks a deterministic presentation-only bend for each relation.
 *
 * The router is deliberately bounded and greedy: the persisted node layout stays
 * authoritative while each edge may take a small/large perpendicular corridor
 * when that avoids already-routed crossings or non-endpoint node centers.
 */
export function routeWorldEdgeBends(
	layout: Readonly<WorldLayout>,
	edges: readonly WorldEdgeDTO[],
): Record<string, number> {
	const bends: Record<string, number> = {};
	const accepted: Array<{ edge: WorldEdgeDTO; path: WorldRoutePolyline }> = [];
	const ordered = [...edges].sort((left, right) => left.id.localeCompare(right.id));

	for (const edge of ordered) {
		const source = layout[edge.source];
		const target = layout[edge.target];
		if (!source || !target) {
			bends[edge.id] = 0;
			continue;
		}
		const distance = Math.hypot(target.x - source.x, target.y - source.y);
		let bestBend = 0;
		let bestPath = worldEdgeRoutePolyline(layout, edge, 0);
		let bestScore = Number.POSITIVE_INFINITY;

		for (const candidate of candidateBends(edge.id, distance)) {
			const path = worldEdgeRoutePolyline(layout, edge, candidate);
			if (!path) continue;
			const score = routeScore(layout, edge, path, candidate, accepted);
			if (score + EPSILON < bestScore) {
				bestScore = score;
				bestBend = candidate;
				bestPath = path;
			}
		}

		bends[edge.id] = Math.round(bestBend * 1000) / 1000;
		if (bestPath) accepted.push({ edge, path: bestPath });
	}

	return bends;
}
