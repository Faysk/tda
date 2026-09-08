import {
	WORLD_LAYOUT_SCHEMA_VERSION,
	sanitizeWorldLayoutProjection,
} from "./layout-contract";
import type {
	WorldGraphProjection,
	WorldLayoutProjection,
	WorldPositionHint,
} from "./model";

function sortedPositions(
	positions: Record<string, WorldPositionHint>,
): Record<string, WorldPositionHint> {
	return Object.fromEntries(
		Object.entries(positions)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([nodeId, position]) => [nodeId, { x: position.x, y: position.y }]),
	);
}

/**
 * Captures an overview-only layout candidate from browser/editor coordinates.
 *
 * The returned revision is the revision the editor observed. A future mutation
 * boundary must use that value for optimistic concurrency before creating the
 * next persisted revision; this helper deliberately does not decide storage or
 * increment revisions on its own.
 */
export function captureWorldLayoutCandidate(
	projection: Pick<WorldGraphProjection, "layout" | "mode" | "nodes">,
	positions: Record<string, WorldPositionHint>,
): WorldLayoutProjection | undefined {
	const candidate: WorldLayoutProjection = {
		schemaVersion: WORLD_LAYOUT_SCHEMA_VERSION,
		view: "overview",
		revision: projection.layout?.revision ?? 0,
		positions,
	};

	const sanitized = sanitizeWorldLayoutProjection(
		candidate,
		new Set(projection.nodes.map((node) => node.id)),
		projection.mode,
	);
	if (!sanitized) return undefined;
	return {
		...sanitized,
		positions: sortedPositions(sanitized.positions),
	};
}

/** Stable, human-reviewable representation suitable for an editorial export. */
export function serializeWorldLayoutCandidate(
	candidate: WorldLayoutProjection,
): string {
	return `${JSON.stringify(
		{
			...candidate,
			positions: sortedPositions(candidate.positions),
		},
		null,
		2,
	)}\n`;
}

/**
 * Parses an exported candidate against the current authorized projection.
 * Hidden/stale node IDs and malformed coordinates are removed fail-closed.
 */
export function parseWorldLayoutCandidate(
	serialized: string,
	projection: Pick<WorldGraphProjection, "mode" | "nodes">,
): WorldLayoutProjection | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(serialized);
	} catch {
		return undefined;
	}

	if (!parsed || typeof parsed !== "object") return undefined;
	const sanitized = sanitizeWorldLayoutProjection(
		parsed as WorldLayoutProjection,
		new Set(projection.nodes.map((node) => node.id)),
		projection.mode,
	);
	if (!sanitized) return undefined;
	return {
		...sanitized,
		positions: sortedPositions(sanitized.positions),
	};
}
