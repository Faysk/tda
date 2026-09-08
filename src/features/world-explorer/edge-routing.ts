import type { WorldLayout, WorldPosition } from "./constellation-layout";
import type { WorldEdgeDTO } from "./model";

export const WORLD_PORT_LANES = [-2, -1, 0, 1, 2] as const;

export type WorldPortLane = (typeof WORLD_PORT_LANES)[number];
export type WorldPortSide = "top" | "right" | "bottom" | "left";

type EndpointKind = "source" | "target";

type EndpointRequest = {
	edgeId: string;
	kind: EndpointKind;
	nodeId: string;
	side: WorldPortSide;
	opposite: WorldPosition;
};

export type WorldEdgeRoute = {
	sourceHandle: string;
	targetHandle: string;
	sourceSide: WorldPortSide;
	targetSide: WorldPortSide;
	sourceLane: WorldPortLane;
	targetLane: WorldPortLane;
	offset: number;
	labelOffset: { x: number; y: number };
};

function cardinalSides(
	source: WorldPosition,
	target: WorldPosition,
): { sourceSide: WorldPortSide; targetSide: WorldPortSide } {
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	if (Math.abs(dx) >= Math.abs(dy)) {
		return dx >= 0
			? { sourceSide: "right", targetSide: "left" }
			: { sourceSide: "left", targetSide: "right" };
	}
	return dy >= 0
		? { sourceSide: "bottom", targetSide: "top" }
		: { sourceSide: "top", targetSide: "bottom" };
}

function laneToken(lane: WorldPortLane): string {
	if (lane === 0) return "c";
	return lane < 0 ? `m${Math.abs(lane)}` : `p${lane}`;
}

export function worldPortHandleId(
	kind: EndpointKind,
	side: WorldPortSide,
	lane: WorldPortLane,
): string {
	return `${kind}-${side}-${laneToken(lane)}`;
}

function endpointSortCoordinate(request: EndpointRequest): number {
	return request.side === "left" || request.side === "right"
		? request.opposite.y
		: request.opposite.x;
}

function centredLane(index: number, count: number): WorldPortLane {
	if (count <= 1) return 0;
	if (count === 2) return index === 0 ? -1 : 1;
	if (count === 3) return WORLD_PORT_LANES[index + 1] ?? 0;
	if (count === 4) return [-2, -1, 1, 2][index] as WorldPortLane;
	if (count === 5) return WORLD_PORT_LANES[index] ?? 0;

	const normalized = index / Math.max(count - 1, 1);
	const laneIndex = Math.round(normalized * (WORLD_PORT_LANES.length - 1));
	return WORLD_PORT_LANES[laneIndex] ?? 0;
}

function endpointKey(request: EndpointRequest): string {
	return `${request.nodeId}:${request.side}`;
}

function assignmentKey(edgeId: string, kind: EndpointKind): string {
	return `${edgeId}:${kind}`;
}

function stableHash(value: string): number {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
	}
	return hash;
}

/**
 * Allocates deterministic lanes on each cardinal side of every visible node.
 * The routing is presentation-only: it spreads busy ports and gives the edge
 * renderer enough clearance without changing relation semantics or layout data.
 */
export function routeWorldEdgePorts(
	layout: Readonly<WorldLayout>,
	edges: readonly WorldEdgeDTO[],
): Record<string, WorldEdgeRoute> {
	const endpointRequests: EndpointRequest[] = [];
	const baseSides = new Map<string, ReturnType<typeof cardinalSides>>();

	for (const edge of edges) {
		const source = layout[edge.source];
		const target = layout[edge.target];
		if (!source || !target) continue;
		const sides = cardinalSides(source, target);
		baseSides.set(edge.id, sides);
		endpointRequests.push(
			{
				edgeId: edge.id,
				kind: "source",
				nodeId: edge.source,
				side: sides.sourceSide,
				opposite: target,
			},
			{
				edgeId: edge.id,
				kind: "target",
				nodeId: edge.target,
				side: sides.targetSide,
				opposite: source,
			},
		);
	}

	const grouped = new Map<string, EndpointRequest[]>();
	for (const request of endpointRequests) {
		const key = endpointKey(request);
		const group = grouped.get(key) ?? [];
		group.push(request);
		grouped.set(key, group);
	}

	const lanes = new Map<string, WorldPortLane>();
	for (const group of grouped.values()) {
		group.sort((left, right) => {
			const delta = endpointSortCoordinate(left) - endpointSortCoordinate(right);
			return delta || left.edgeId.localeCompare(right.edgeId);
		});
		group.forEach((request, index) => {
			lanes.set(assignmentKey(request.edgeId, request.kind), centredLane(index, group.length));
		});
	}

	const routes: Record<string, WorldEdgeRoute> = {};
	for (const edge of edges) {
		const sides = baseSides.get(edge.id);
		if (!sides) continue;
		const sourceLane = lanes.get(assignmentKey(edge.id, "source")) ?? 0;
		const targetLane = lanes.get(assignmentKey(edge.id, "target")) ?? 0;
		const laneMagnitude = Math.max(Math.abs(sourceLane), Math.abs(targetLane));
		const routeJitter = stableHash(edge.id) % 3;
		const horizontal = sides.sourceSide === "left" || sides.sourceSide === "right";
		const averageLane = (sourceLane + targetLane) / 2;

		routes[edge.id] = {
			sourceHandle: worldPortHandleId("source", sides.sourceSide, sourceLane),
			targetHandle: worldPortHandleId("target", sides.targetSide, targetLane),
			sourceSide: sides.sourceSide,
			targetSide: sides.targetSide,
			sourceLane,
			targetLane,
			offset: 24 + laneMagnitude * 7 + routeJitter * 2,
			labelOffset: horizontal
				? { x: 0, y: Math.round(averageLane * 7) }
				: { x: Math.round(averageLane * 7), y: 0 },
		};
	}
	return routes;
}
