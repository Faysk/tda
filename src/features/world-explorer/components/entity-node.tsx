"use client";

import Image from "next/image";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import type { WorldFlowNode } from "../adapters/react-flow";
import {
	WORLD_PORT_LANES,
	type WorldPortSide,
	worldPortHandleId,
} from "../edge-routing";
import styles from "./world-explorer.module.css";

const SIDES: Array<{ side: WorldPortSide; position: Position }> = [
	{ side: "top", position: Position.Top },
	{ side: "right", position: Position.Right },
	{ side: "bottom", position: Position.Bottom },
	{ side: "left", position: Position.Left },
];

function laneStyle(side: WorldPortSide, lane: number): CSSProperties {
	const placement = `${50 + lane * 14}%`;
	return side === "top" || side === "bottom"
		? { left: placement }
		: { top: placement };
}

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
			{SIDES.flatMap(({ side, position }) =>
				WORLD_PORT_LANES.flatMap((lane) => {
					const sourceId = worldPortHandleId("source", side, lane);
					const targetId = worldPortHandleId("target", side, lane);
					const style = laneStyle(side, lane);
					return [
						<Handle
							key={sourceId}
							id={sourceId}
							type="source"
							position={position}
							style={style}
							className={styles.hiddenHandle}
							isConnectable={false}
						/>,
						<Handle
							key={targetId}
							id={targetId}
							type="target"
							position={position}
							style={style}
							className={styles.hiddenHandle}
							isConnectable={false}
						/>,
					];
				}),
			)}
			<div className={styles.nodePortrait} aria-hidden="true">
				{item.imageUrl ? (
					<Image className={styles.nodeImage} src={item.imageUrl} alt="" fill sizes={isHero ? "116px" : "90px"} />
				) : (
					<span className={styles.nodeInitials}>{initials(item.label)}</span>
				)}
				{isHero ? <i className={styles.heroOrbit} /> : null}
			</div>
			<div className={styles.nodeLabel}>{item.label}</div>
			{item.subtitle ? <div className={styles.nodeSubtitle}>{item.subtitle}</div> : null}
		</div>
	);
}
