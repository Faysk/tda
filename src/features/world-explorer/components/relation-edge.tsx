"use client";

import {
	BaseEdge,
	EdgeLabelRenderer,
	getBezierPath,
	type EdgeProps,
} from "@xyflow/react";
import type { WorldFlowEdge } from "../adapters/react-flow";
import type { WorldRelationFamily } from "../model";
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

const RELATION_DASHES: Partial<Record<WorldRelationFamily, string>> = {
	conflict: "5 5",
	mystic: "2 5",
	origin: "7 5",
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

export function WorldRelationEdge(props: EdgeProps<WorldFlowEdge>) {
	const routeOffset = props.data?.routeOffset ?? 28;
	const labelOffset = props.data?.labelOffset ?? { x: 0, y: 0 };
	const family = props.data?.family ?? "context";
	const curvature = relationCurvature(family, routeOffset);
	const [path, labelX, labelY] = getBezierPath({
		sourceX: props.sourceX,
		sourceY: props.sourceY,
		sourcePosition: props.sourcePosition,
		targetX: props.targetX,
		targetY: props.targetY,
		targetPosition: props.targetPosition,
		curvature,
	});
	const item = props.data?.item;
	const highlighted = props.data?.isHighlighted ?? false;
	const dimmed = props.data?.isDimmed ?? false;
	const stroke = RELATION_STROKES[family];
	const strokeWidth = highlighted ? 4 : 3;
	const strokeOpacity = dimmed ? 0.12 : highlighted ? 1 : 0.94;
	const dash = RELATION_DASHES[family];

	// Chrome has been unreliable painting the native React Flow edge SVG in this
	// composition. Keep the hit target there, but paint the visible curve in the
	// same transformed layer as labels, which is proven stable in both themes.
	const paintPadding = Math.max(120, routeOffset * 3);
	const paintLeft = Math.min(props.sourceX, props.targetX) - paintPadding;
	const paintTop = Math.min(props.sourceY, props.targetY) - paintPadding;
	const paintWidth = Math.abs(props.targetX - props.sourceX) + paintPadding * 2;
	const paintHeight = Math.abs(props.targetY - props.sourceY) + paintPadding * 2;

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
						data-world-edge={props.id}
					/>
				</svg>
				{item ? (
					<div
						className={`${styles.edgeLabel} ${highlighted ? styles.edgeLabelHighlighted : ""} ${dimmed ? styles.edgeLabelDimmed : ""}`}
						data-family={family}
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
