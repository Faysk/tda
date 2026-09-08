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
	affinity: "var(--world-edge-affinity, #65c98a)",
	family: "var(--world-edge-family, #e4b455)",
	conflict: "var(--world-edge-conflict, #ef5c58)",
	authority: "var(--world-edge-context, #8f9aa8)",
	faction: "var(--world-edge-context, #8f9aa8)",
	origin: "var(--world-edge-origin, #6caee8)",
	mystic: "var(--world-edge-mystic, #a97df2)",
	creative: "var(--world-edge-creative, #f0a14d)",
	context: "var(--world-edge-context, #8f9aa8)",
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
	const visibleClassName = `${styles.relationPath} ${highlighted ? styles.relationPathHighlighted : ""} ${dimmed ? styles.relationPathDimmed : ""}`;

	return (
		<>
			<path
				d={path}
				fill="none"
				stroke="rgba(2, 5, 8, 0.9)"
				strokeWidth={strokeWidth + 4.4}
				strokeOpacity={dimmed ? 0.1 : 0.78}
				vectorEffect="non-scaling-stroke"
				strokeLinecap="round"
				strokeLinejoin="round"
				pointerEvents="none"
			/>
			<BaseEdge
				id={`${props.id}-visible`}
				path={path}
				markerEnd={props.markerEnd}
				interactionWidth={30}
				className={visibleClassName}
				data-family={family}
				data-world-edge={props.id}
				vectorEffect="non-scaling-stroke"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{
					...props.style,
					fill: "none",
					stroke,
					strokeWidth,
					strokeOpacity,
				}}
			/>
			{item ? (
				<EdgeLabelRenderer>
					<div
						className={`${styles.edgeLabel} ${highlighted ? styles.edgeLabelHighlighted : ""} ${dimmed ? styles.edgeLabelDimmed : ""}`}
						data-family={family}
						style={{
							transform: `translate(-50%, -50%) translate(${labelX + labelOffset.x}px, ${labelY + labelOffset.y}px)`,
						}}
					>
						{item.label}
					</div>
				</EdgeLabelRenderer>
			) : null}
		</>
	);
}
