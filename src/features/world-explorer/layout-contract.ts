import type {
	WorldGraphMode,
	WorldGraphProjection,
	WorldLayoutProjection,
	WorldPositionHint,
} from "./model";

export const WORLD_LAYOUT_SCHEMA_VERSION = 1 as const;
export const WORLD_LAYOUT_COORDINATE_LIMIT = 5_000;

function isWorldPosition(value: unknown): value is WorldPositionHint {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { x?: unknown; y?: unknown };
	if (typeof candidate.x !== "number" || typeof candidate.y !== "number") return false;
	if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return false;
	return (
		Math.abs(candidate.x) <= WORLD_LAYOUT_COORDINATE_LIMIT &&
		Math.abs(candidate.y) <= WORLD_LAYOUT_COORDINATE_LIMIT
	);
}

function isValidRevision(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Defensive boundary for an editorial layout before it joins a browser-facing
 * World Explorer projection.
 *
 * The caller still owns campaign/scope authorization. This function guarantees
 * that the resulting payload contains coordinates only for node IDs already
 * present in the authorized projection and rejects malformed/stale coordinates.
 */
export function sanitizeWorldLayoutProjection(
	layout: WorldLayoutProjection | undefined,
	visibleNodeIds: ReadonlySet<string>,
	mode: WorldGraphMode,
): WorldLayoutProjection | undefined {
	if (!layout || mode !== "overview") return undefined;
	if (
		layout.schemaVersion !== WORLD_LAYOUT_SCHEMA_VERSION ||
		layout.view !== "overview" ||
		!isValidRevision(layout.revision)
	) {
		return undefined;
	}

	const positions: Record<string, WorldPositionHint> = {};
	for (const [nodeId, position] of Object.entries(layout.positions)) {
		if (!visibleNodeIds.has(nodeId) || !isWorldPosition(position)) continue;
		positions[nodeId] = { x: position.x, y: position.y };
	}

	return {
		schemaVersion: WORLD_LAYOUT_SCHEMA_VERSION,
		view: "overview",
		revision: layout.revision,
		positions,
	};
}

/**
 * Returns the persisted/editorial positions that are safe to apply to the
 * current projection. Focus mode deliberately ignores overview persistence.
 */
export function worldLayoutOverrides(
	projection: Pick<WorldGraphProjection, "layout" | "mode" | "nodes">,
): Record<string, WorldPositionHint> {
	const visibleNodeIds = new Set(projection.nodes.map((node) => node.id));
	return (
		sanitizeWorldLayoutProjection(
			projection.layout,
			visibleNodeIds,
			projection.mode,
		)?.positions ?? {}
	);
}
