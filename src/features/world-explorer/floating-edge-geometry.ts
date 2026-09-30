import { Position } from "@xyflow/react";
import type { WorldPortLane, WorldPortSide } from "./edge-routing";

export type FloatingNodeBox = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type FloatingEdgeGeometry = {
	sourceX: number;
	sourceY: number;
	targetX: number;
	targetY: number;
	sourcePosition: Position;
	targetPosition: Position;
};

export type FloatingEdgeEndpointRoute = Readonly<{
	side: WorldPortSide;
	lane: WorldPortLane;
}>;

export type FloatingEdgeRoute = Readonly<{
	source?: FloatingEdgeEndpointRoute;
	target?: FloatingEdgeEndpointRoute;
}>;

type BoundaryPoint = {
	x: number;
	y: number;
	position: Position;
};

function sidePosition(side: WorldPortSide): Position {
	switch (side) {
		case "top":
			return Position.Top;
		case "right":
			return Position.Right;
		case "bottom":
			return Position.Bottom;
		case "left":
			return Position.Left;
	}
}

function unroutedBoundaryPoint(
	node: FloatingNodeBox,
	opposite: FloatingNodeBox,
): BoundaryPoint {
	const rx = Math.max(node.width / 2, 1);
	const ry = Math.max(node.height / 2, 1);
	const centerX = node.x + rx;
	const centerY = node.y + ry;
	const oppositeCenterX = opposite.x + opposite.width / 2;
	const oppositeCenterY = opposite.y + opposite.height / 2;
	const dx = oppositeCenterX - centerX;
	const dy = oppositeCenterY - centerY;
	const distance = Math.hypot(dx, dy);

	if (distance < 0.001) {
		return { x: centerX + rx + 2, y: centerY, position: Position.Right };
	}

	const denominator = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
	const scale = denominator > 0 ? 1 / denominator : 0;
	const unitX = dx / distance;
	const unitY = dy / distance;
	const normalizedX = Math.abs(dx / rx);
	const normalizedY = Math.abs(dy / ry);
	const position =
		normalizedX >= normalizedY
			? dx >= 0
				? Position.Right
				: Position.Left
			: dy >= 0
				? Position.Bottom
				: Position.Top;

	return {
		x: centerX + dx * scale + unitX * 2,
		y: centerY + dy * scale + unitY * 2,
		position,
	};
}

function routedBoundaryPoint(
	node: FloatingNodeBox,
	opposite: FloatingNodeBox,
	route: FloatingEdgeEndpointRoute,
): BoundaryPoint {
	const rx = Math.max(node.width / 2, 1);
	const ry = Math.max(node.height / 2, 1);
	const centerX = node.x + rx;
	const centerY = node.y + ry;
	const oppositeCenterX = opposite.x + opposite.width / 2;
	const oppositeCenterY = opposite.y + opposite.height / 2;
	const dx = oppositeCenterX - centerX;
	const dy = oppositeCenterY - centerY;
	const denominator = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
	const scale = denominator > 0 ? 1 / denominator : 0;
	const projectedX = centerX + dx * scale;
	const projectedY = centerY + dy * scale;
	const horizontalSide = route.side === "left" || route.side === "right";
	const secondaryRadius = horizontalSide ? ry : rx;
	const baseSecondary = horizontalSide ? projectedY - centerY : projectedX - centerX;

	// Handles use 14% steps around the node box. Mirror that spacing on the
	// visible silhouette, then clamp before the ellipse gets too close to its
	// tangent so busy hubs fan out without producing near-vertical edge stubs.
	const laneOffset = route.lane * secondaryRadius * 0.28;
	const secondary = Math.max(
		-secondaryRadius * 0.72,
		Math.min(secondaryRadius * 0.72, baseSecondary + laneOffset),
	);
	const normalizedSecondary =
		secondaryRadius > 0 ? Math.min(1, Math.abs(secondary) / secondaryRadius) : 0;
	const primaryFactor = Math.sqrt(Math.max(0, 1 - normalizedSecondary ** 2));
	const position = sidePosition(route.side);

	if (horizontalSide) {
		const direction = route.side === "right" ? 1 : -1;
		return {
			x: centerX + direction * rx * primaryFactor + direction * 2,
			y: centerY + secondary,
			position,
		};
	}

	const direction = route.side === "bottom" ? 1 : -1;
	return {
		x: centerX + secondary,
		y: centerY + direction * ry * primaryFactor + direction * 2,
		position,
	};
}

function boundaryPoint(
	node: FloatingNodeBox,
	opposite: FloatingNodeBox,
	route?: FloatingEdgeEndpointRoute,
): BoundaryPoint {
	return route
		? routedBoundaryPoint(node, opposite, route)
		: unroutedBoundaryPoint(node, opposite);
}

/**
 * Connects the edge to the visible node silhouette instead of a fixed handle.
 *
 * When deterministic port routing is available, the visual endpoint mirrors
 * that route on the silhouette. This keeps the organic floating-edge look while
 * preserving the lane fan-out that prevents busy hubs from collapsing several
 * relations onto the same apparent connection point.
 */
export function getFloatingEdgeGeometry(
	source: FloatingNodeBox,
	target: FloatingNodeBox,
	route?: FloatingEdgeRoute,
): FloatingEdgeGeometry {
	const sourcePoint = boundaryPoint(source, target, route?.source);
	const targetPoint = boundaryPoint(target, source, route?.target);
	return {
		sourceX: sourcePoint.x,
		sourceY: sourcePoint.y,
		targetX: targetPoint.x,
		targetY: targetPoint.y,
		sourcePosition: sourcePoint.position,
		targetPosition: targetPoint.position,
	};
}
