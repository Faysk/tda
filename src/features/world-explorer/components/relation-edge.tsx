"use client";

import {
	BaseEdge,
	EdgeLabelRenderer,
	getBezierPath,
	type EdgeProps,
	useInternalNode,
} from "@xyflow/react";
import type { WorldFlowEdge } from "../adapters/react-flow";
import {
	getFloatingEdgeGeometry,
	type FloatingNodeBox,
} from "../floating-edge-geometry";
import type { WorldRelationFamily } from "../model";
import effects from "./relation-edge-effects.module.css";
import styles from "./world-explorer.module.css";

const RELATION_STROKES: Record<WorldRelationFamily, string> = {
	affinity: "#65c98a",
	family: "#e4b455",
	conflict: "#ef5c58",
	authority: "#8f9aa8",
	faction: "#8f9aa8",
	origin: "#6caee8",
	mystic: "#a97df2",
	creative: "#f0a14d",
	context: "#8f9aa8",
};

const RELATION_MOTION_STROKES: Record<WorldRelationFamily, string> = {
	affinity: "#d9ffe7",
	family: "#fff0b5",
	conflict: "#ffd6d2",
	authority: "#e2e9f0",
	faction: "#e2e9f0",
	origin: "#d7ecff",
	mystic: "#eadcff",
	creative: "#ffe0bd",
	context: "#e2e9f0",
};

const RELATION_DASHES: Partial<Record<WorldRelationFamily, string>> = {
	conflict: "5 5",
	mystic: "2 5",
	origin: "7 5",
};

type InternalNodeLike = {
	measured?: { width?: number; height?: number };
	internals?: { positionAbsolute?: { x: number; y: number } };
};

function relationCurvature(
	family: WorldRelationFamily,
	routeOffset: number,
): number {
	const familyBase =
		family === "mystic"
			? 0.33
			: family === "conflict"
				? 0.3
				: family === "creative"
					? 0.28
					: 0.24;
	const laneVariation = Math.min(0.11, Math.max(0, routeOffset - 24) * 0.007);
	return Math.min(0.44, familyBase + laneVariation);
}

function floatingBox(node: InternalNodeLike | undefined): FloatingNodeBox | null {
	const width = node?.measured?.width;
	const height = node?.measured?.height;
	const position = node?.internals?.positionAbsolute;
	if (
		typeof width !== "number" ||
		typeof height !== "number" ||
		width <= 0 ||
		height <= 0 ||
		!position
	) {
		return null;
	}
	return { x: position.x, y: position.y, width, height };
}

export function WorldRelationEdge(props: EdgeProps<WorldFlowEdge>) {
	const sourceNode = useInternalNode(props.source);
	const targetNode = useInternalNode(props.target);
	const sourceBox = floatingBox(sourceNode);
	const targetBox = floatingBox(targetNode);
	const floating = sourceBox && targetBox ? getFloatingEdgeGeometry(sourceBox, targetBox) : null;
	const routeOffset = props.data?.routeOffset ?? 28;
	const labelOffset = props.data?.labelOffset ?? { x: 0, y: 0 };
	const family = props.data?.family ?? "context";
	const curvature = relationCurvature(family, routeOffset);
	const sourceX = floating?.sourceX ?? props.sourceX;
	const sourceY = floating?.sourceY ?? props.sourceY;
	const targetX = floating?.targetX ?? props.targetX;
	const targetY = floating?.targetY ?? props.targetY;
	const sourcePosition = floating?.sourcePosition ?? props.sourcePosition;
	const targetPosition = floating?.targetPosition ?? props.targetPosition;
	const [path, labelX, labelY] = getBezierPath({
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition,
		curvature,
	});
	const item = props.data?.item;
	const highlighted = props.data?.isHighlighted ?? false;
	const dimmed = props.data?.isDimmed ?? false;
	const stroke = RELATION_STROKES[family];
	const motionStroke = RELATION_MOTION_STROKES[family];
	const strokeWidth = highlighted ? 3.6 : 3;
	const strokeOpacity = dimmed ? 0.12 : highlighted ? 1 : 0.94;
	const dash = RELATION_DASHES[family];

	// Chrome has been unreliable painting the native React Flow edge SVG in this
	// composition. Keep the hit target there, but paint the visible curve in the
	// same transformed layer as labels, which is proven stable in both themes.
	const paintPadding = Math.max(120, routeOffset * 3);
	const paintLeft = Math.min(sourceX, targetX) - paintPadding;
	const paintTop = Math.min(sourceY, targetY) - paintPadding;
	const paintWidth = Math.abs(targetX - sourceX) + paintPadding * 2;
	const paintHeight = Math.abs(targetY - sourceY) + paintPadding * 2;

	return (
		<>
			<BaseEdge
				id={`${props.id}-interaction`}
				path={path}
				interactionWidth={32}
				style={{
					fill: "none",
					stroke: "transparent",
					strokeWidth: 1,
					strokeOpacity: 0,
				}}
			/>
			<EdgeLabelRenderer>
				<svg
					viewBox={`${paintLeft} ${paintTop} ${paintWidth} ${paintHeight}`}
					width={paintWidth}
					height={paintHeight}
					style={{
						position: "absolute",
						left: paintLeft,
						top: paintTop,
						overflow: "visible",
						pointerEvents: "none",
					}}
					aria-hidden="true"
				>
					<path
						d={path}
						fill="none"
						stroke="var(--ds-canvas)"
						strokeWidth={strokeWidth + 3}
						strokeOpacity={dimmed ? 0.04 : highlighted ? 0.7 : 0.46}
						strokeDasharray={dash}
						vectorEffect="non-scaling-stroke"
						strokeLinecap="round"
					/>
					<path
						d={path}
						fill="none"
						stroke={stroke}
						strokeWidth={strokeWidth}
						strokeOpacity={strokeOpacity}
						strokeDasharray={dash}
						vectorEffect="non-scaling-stroke"
						strokeLinecap="round"
						data-family={family}
						data-edge-curve="bezier"
						data-edge-anchor={floating ? "floating" : "handle"}
						data-world-edge={props.id}
					/>
					{highlighted && !dimmed ? (
						<path
							d={path}
							className={effects.flowMotion}
							fill="none"
							stroke={motionStroke}
							strokeWidth={2.6}
							strokeOpacity={0.98}
							strokeDasharray="1 11"
							strokeDashoffset="0"
							vectorEffect="non-scaling-stroke"
							strokeLinecap="round"
							data-family={family}
							data-motion-contrast="bright"
							data-world-edge-motion={props.id}
						/>
					) : null}
				</svg>
				{item && !dimmed ? (
					<div
						className={`${styles.edgeLabel} ${highlighted ? styles.edgeLabelHighlighted : ""}`}
						data-family={family}
						data-world-edge-label={props.id}
						aria-hidden="true"
						style={{
							transform: `translate(-50%, -50%) translate(${labelX + labelOffset.x}px, ${labelY + labelOffset.y}px)`,
						}}
					>
						{item.label}
					</div>
				) : null}
			</EdgeLabelRenderer>
		</>
	);
}
