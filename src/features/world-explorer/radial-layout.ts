import type { WorldGraphProjection, WorldNodeDTO } from "./model";

export type WorldPosition = { x: number; y: number };

export type WorldLayout = Record<string, WorldPosition>;

const TYPE_ORDER: Record<string, number> = {
	location: 0,
	npc: 1,
	pc: 2,
	concept: 3,
	organization: 4,
	faction: 5,
	song: 6,
	quest: 7,
	item: 8,
	arc: 9,
	moment: 10,
};

function nodeOrder(node: WorldNodeDTO): number {
	if (node.kind === "moment") return TYPE_ORDER.moment;
	return TYPE_ORDER[node.entityType ?? ""] ?? 99;
}

function stableNodes(nodes: WorldNodeDTO[]): WorldNodeDTO[] {
	return [...nodes].sort((left, right) => {
		const byType = nodeOrder(left) - nodeOrder(right);
		if (byType !== 0) return byType;
		return left.label.localeCompare(right.label, "pt-BR");
	});
}

function pointOnRing(index: number, count: number, radius: number): WorldPosition {
	const start = -Math.PI / 2;
	const angle = start + (index / Math.max(count, 1)) * Math.PI * 2;
	return {
		x: Math.round(Math.cos(angle) * radius),
		y: Math.round(Math.sin(angle) * radius),
	};
}

/**
 * Produces a deterministic, presentation-only radial layout.
 *
 * The focus is always at the origin. Up to eight neighbours occupy the inner
 * ring; any remaining neighbours move to a wider second ring. Positions are
 * derived from stable semantic/type ordering and are never persisted.
 */
export function radialWorldLayout(
	projection: WorldGraphProjection,
): WorldLayout {
	const layout: WorldLayout = {
		[projection.focusId]: { x: 0, y: 0 },
	};
	const neighbours = stableNodes(
		projection.nodes.filter((node) => node.id !== projection.focusId),
	);
	const inner = neighbours.slice(0, 8);
	const outer = neighbours.slice(8);

	inner.forEach((node, index) => {
		layout[node.id] = pointOnRing(index, inner.length, 310);
	});
	outer.forEach((node, index) => {
		const offset = pointOnRing(index, outer.length, 475);
		layout[node.id] = {
			x: -offset.x,
			y: -offset.y,
		};
	});

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
