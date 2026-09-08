"use client";

import {
	BaseEdge,
	EdgeLabelRenderer,
	getBezierPath,
	type EdgeProps,
} from "@xyflow/react";
import type { WorldFlowEdge } from "../adapters/react-flow";
import styles from "./world-explorer.module.css";

export function WorldRelationEdge(props: EdgeProps<WorldFlowEdge>) {
	const [path, labelX, labelY] = getBezierPath({
		sourceX: props.sourceX,
		sourceY: props.sourceY,
		sourcePosition: props.sourcePosition,
		targetX: props.targetX,
		targetY: props.targetY,
		targetPosition: props.targetPosition,
		curvature: 0.38,
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
							transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
						}}
					>
						{item.label}
					</div>
				</EdgeLabelRenderer>
			) : null}
		</>
	);
}
