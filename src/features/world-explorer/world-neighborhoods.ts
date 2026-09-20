import type { WorldFlowNode } from "./adapters/react-flow";

export type WorldVisualNeighborhood = Readonly<{
	id: string;
	label: string;
	nodeCount: number;
	x: number;
	y: number;
	width: number;
	height: number;
}>;

const MAX_NEIGHBORHOOD_DISTANCE = 1_550;
const SHARED_DISTANCE_RATIO = 1.22;
const REGION_PADDING_X = 190;
const REGION_PADDING_Y = 150;
const REGION_MIN_WIDTH = 420;
const REGION_MIN_HEIGHT = 340;

function distanceSquared(
	left: { x: number; y: number },
	right: { x: number; y: number },
): number {
	const dx = left.x - right.x;
	const dy = left.y - right.y;
	return dx * dx + dy * dy;
}

function estimatedRadius(node: WorldFlowNode): number {
	if (node.data.isHero) return 78;
	if (node.data.prominence === "primary") return 58;
	if (node.data.prominence === "context") return 42;
	return 50;
}

/**
 * Builds presentation-only spatial neighborhoods around hero hubs.
 *
 * Membership follows the editorial map, not canon. Nodes that sit similarly
 * close to two heroes are deliberately left shared instead of being forced
 * into an arbitrary region.
 */
export function deriveWorldVisualNeighborhoods(
	nodes: readonly WorldFlowNode[],
): WorldVisualNeighborhood[] {
	const heroes = nodes
		.filter((node) => node.data.isHero)
		.sort((left, right) => left.data.item.label.localeCompare(right.data.item.label, "pt-BR"));
	if (heroes.length === 0) return [];

	const members = new Map<string, WorldFlowNode[]>(
		heroes.map((hero) => [hero.id, [hero]]),
	);

	for (const node of nodes) {
		if (node.data.isHero) continue;
		const ranked = heroes
			.map((hero) => ({
				hero,
				distance: Math.sqrt(distanceSquared(node.position, hero.position)),
			}))
			.sort(
				(left, right) =>
					left.distance - right.distance || left.hero.id.localeCompare(right.hero.id),
			);
		const closest = ranked[0];
		if (!closest || closest.distance > MAX_NEIGHBORHOOD_DISTANCE) continue;
		const second = ranked[1];
		if (
			second &&
			second.distance <= closest.distance * SHARED_DISTANCE_RATIO
		) {
			continue;
		}
		members.get(closest.hero.id)?.push(node);
	}

	return heroes.flatMap((hero) => {
		const group = members.get(hero.id) ?? [hero];
		if (group.length < 2) return [];

		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		for (const node of group) {
			const radius = estimatedRadius(node);
			minX = Math.min(minX, node.position.x - radius);
			maxX = Math.max(maxX, node.position.x + radius);
			minY = Math.min(minY, node.position.y - radius);
			maxY = Math.max(maxY, node.position.y + radius);
		}

		const contentWidth = maxX - minX;
		const contentHeight = maxY - minY;
		const width = Math.max(REGION_MIN_WIDTH, contentWidth + REGION_PADDING_X * 2);
		const height = Math.max(REGION_MIN_HEIGHT, contentHeight + REGION_PADDING_Y * 2);
		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;

		return [
			{
				id: hero.id,
				label: hero.data.item.label,
				nodeCount: group.length,
				x: Math.round(centerX - width / 2),
				y: Math.round(centerY - height / 2),
				width: Math.round(width),
				height: Math.round(height),
			},
		];
	});
}
