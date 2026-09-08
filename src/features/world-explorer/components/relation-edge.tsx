"use client";

import {
	BaseEdge,
	EdgeLabelRenderer,
	getSmoothStepPath,
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
	conflict: "8 6",
	mystic: "3 6",
	origin: "10 5",
};

export function WorldRelationEdge(props: EdgeProps<WorldFlowEdge>) {
	const routeOffset = props.data?.routeOffset ?? 28;
	const labelOffset = props.data?.labelOffset ?? { x: 0, y: 0 };
	const [path, labelX, labelY] = getSmoothStepPath({
		sourceX: props.sourceX,
		sourceY: props.sourceY,
		sourcePosition: props.sourcePosition,
		targetX: props.targetX,
		targetY: props.targetY,
		targetPosition: props.targetPosition,
		borderRadius: 18,
		offset: routeOffset,
		stepPosition: 0.5,
	});
	const item = props.data?.item;
	const family = props.data?.family ?? "context";
	const highlighted = props.data?.isHighlighted ?? false;
	const dimmed = props.data?.isDimmed ?? false;
	const stroke = RELATION_STROKES[family];
	const strokeWidth = highlighted ? 4.4 : 3.2;
	const strokeOpacity = dimmed ? 0.2 : highlighted ? 1 : 0.98;
	const dash = RELATION_DASHES[family];

	// EdgeLabelRenderer is already proven visible in Chrome because it paints the
	// relation labels. Paint the visual stroke in that same transformed HTML
	// layer instead of relying on React Flow's internal edge SVG stacking layer.
	const paintPadding = Math.max(72, routeOffset + 36);
	const paintLeft = Math.min(props.sourceX, props.targetX) - paintPadding;
	const paintTop = Math.min(props.sourceY, props.targetY) - paintPadding;
	const paintWidth = Math.abs(props.targetX - props.sourceX) + paintPadding * 2;
	const paintHeight = Math.abs(props.targetY - props.sourceY) + paintPadding * 2;

	return (
		<>
			<BaseEdge
				id={`${props.id}-interaction`}
				path={path}
				interactionWidth={30}
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
						strokeWidth={strokeWidth + 5}
						strokeOpacity={dimmed ? 0.08 : 0.92}
						strokeDasharray={dash}
						vectorEffect="non-scaling-stroke"
						strokeLinecap="round"
						strokeLinejoin="round"
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
						strokeLinejoin="round"
						data-family={family}
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
