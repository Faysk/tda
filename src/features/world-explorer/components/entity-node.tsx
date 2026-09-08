"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { WorldFlowNode } from "../adapters/react-flow";
import styles from "./world-explorer.module.css";

const HANDLES = [
	{ source: "source-top", target: "target-top", position: Position.Top },
	{ source: "source-right", target: "target-right", position: Position.Right },
	{ source: "source-bottom", target: "target-bottom", position: Position.Bottom },
	{ source: "source-left", target: "target-left", position: Position.Left },
] as const;

function initials(label: string): string {
	return label
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part.charAt(0))
		.join("")
		.toLocaleUpperCase("pt-BR");
}

export function WorldEntityNode({ data, selected }: NodeProps<WorldFlowNode>) {
	const { item, isFocus, isHero, prominence, isDimmed } = data;
	return (
		<div
			className={`${styles.entityNode} ${isHero ? styles.entityNodeHero : ""} ${isFocus ? styles.entityNodeFocus : ""} ${selected ? styles.entityNodeSelected : ""} ${isDimmed ? styles.entityNodeDimmed : ""}`}
			data-world-node={item.id}
			data-prominence={prominence}
		>
			{HANDLES.flatMap((handle) => [
				<Handle
					key={handle.source}
					id={handle.source}
					type="source"
					position={handle.position}
					className={styles.hiddenHandle}
					isConnectable={false}
				/>,
				<Handle
					key={handle.target}
					id={handle.target}
					type="target"
					position={handle.position}
					className={styles.hiddenHandle}
					isConnectable={false}
				/>,
			])}
			<div className={styles.nodePortrait} aria-hidden="true">
				{item.imageUrl ? (
					<img src={item.imageUrl} alt="" />
				) : (
					<span>{initials(item.label)}</span>
				)}
				{isHero ? <i className={styles.heroOrbit} /> : null}
			</div>
			<div className={styles.nodeLabel}>{item.label}</div>
			{item.subtitle ? <div className={styles.nodeSubtitle}>{item.subtitle}</div> : null}
		</div>
	);
}
