import { Position } from "@xyflow/react";

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

type BoundaryPoint = {
	x: number;
	y: number;
	position: Position;
};

function boundaryPoint(node: FloatingNodeBox, opposite: FloatingNodeBox): BoundaryPoint {
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

/**
 * Connects the edge to the visible node silhouette instead of a fixed handle.
 * The result follows the node while it is dragged and keeps the curve pointing
 * toward the opposite entity, which makes the graph read more like a narrative
 * constellation than a port-based flowchart.
 */
export function getFloatingEdgeGeometry(
	source: FloatingNodeBox,
	target: FloatingNodeBox,
): FloatingEdgeGeometry {
	const sourcePoint = boundaryPoint(source, target);
	const targetPoint = boundaryPoint(target, source);
	return {
		sourceX: sourcePoint.x,
		sourceY: sourcePoint.y,
		targetX: targetPoint.x,
		targetY: targetPoint.y,
		sourcePosition: sourcePoint.position,
		targetPosition: targetPoint.position,
	};
}
