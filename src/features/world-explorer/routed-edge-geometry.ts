import { Position } from "@xyflow/react";

export type RoutedBezierPath = readonly [string, number, number];

function tangent(position: Position): { x: number; y: number } {
	switch (position) {
		case Position.Top:
			return { x: 0, y: -1 };
		case Position.Right:
			return { x: 1, y: 0 };
		case Position.Bottom:
			return { x: 0, y: 1 };
		case Position.Left:
			return { x: -1, y: 0 };
	}
}

function cubicMidpoint(
	source: { x: number; y: number },
	controlA: { x: number; y: number },
	controlB: { x: number; y: number },
	target: { x: number; y: number },
) {
	return {
		x: (source.x + 3 * controlA.x + 3 * controlB.x + target.x) / 8,
		y: (source.y + 3 * controlA.y + 3 * controlB.y + target.y) / 8,
	};
}

export function getRoutedBezierPath({
	sourceX,
	sourceY,
	sourcePosition,
	targetX,
	targetY,
	targetPosition,
	bendOffset,
}: {
	sourceX: number;
	sourceY: number;
	sourcePosition: Position;
	targetX: number;
	targetY: number;
	targetPosition: Position;
	bendOffset: number;
}): RoutedBezierPath {
	const dx = targetX - sourceX;
	const dy = targetY - sourceY;
	const distance = Math.max(Math.hypot(dx, dy), 1);
	const normal = { x: -dy / distance, y: dx / distance };
	const controlDistance = Math.min(220, Math.max(44, distance * 0.32));
	const sourceTangent = tangent(sourcePosition);
	const targetTangent = tangent(targetPosition);
	const source = { x: sourceX, y: sourceY };
	const target = { x: targetX, y: targetY };
	const controlA = {
		x: sourceX + sourceTangent.x * controlDistance + normal.x * bendOffset,
		y: sourceY + sourceTangent.y * controlDistance + normal.y * bendOffset,
	};
	const controlB = {
		x: targetX + targetTangent.x * controlDistance + normal.x * bendOffset,
		y: targetY + targetTangent.y * controlDistance + normal.y * bendOffset,
	};
	const label = cubicMidpoint(source, controlA, controlB, target);
	return [
		`M ${sourceX},${sourceY} C ${controlA.x},${controlA.y} ${controlB.x},${controlB.y} ${targetX},${targetY}`,
		label.x,
		label.y,
	];
}
