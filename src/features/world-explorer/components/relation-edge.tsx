"use client";

import {
	BaseEdge,
	EdgeLabelRenderer,
	getSmoothStepPath,
	type EdgeProps,
} from "@xyflow/react";
import type { WorldFlowEdge } from "../adapters/react-flow";
import styles from "./world-explorer.module.css";

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

	return (
		<>
			<BaseEdge
				id={props.id}
				path={path}
				markerEnd={props.markerEnd}
				className={`${styles.relationPath} ${highlighted ? styles.relationPathHighlighted : ""} ${dimmed ? styles.relationPathDimmed : ""}`}
				data-family={family}
				interactionWidth={30}
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
