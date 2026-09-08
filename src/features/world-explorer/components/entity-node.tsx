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
import type { WorldNodeDTO } from "../model";
import nodeStyles from "./entity-node-v2.module.css";

const SIDES: Array<{ side: WorldPortSide; position: Position }> = [
	{ side: "top", position: Position.Top },
	{ side: "right", position: Position.Right },
	{ side: "bottom", position: Position.Bottom },
	{ side: "left", position: Position.Left },
];

type VisualKind =
	| "hero"
	| "character"
	| "location"
	| "faction"
	| "song"
	| "moment"
	| "context";

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

function visualKind(item: WorldNodeDTO, isHero: boolean): VisualKind {
	if (isHero) return "hero";
	if (item.kind === "moment") return "moment";
	if (item.entityType === "pc" || item.entityType === "npc") return "character";
	if (item.entityType === "location") return "location";
	if (item.entityType === "faction" || item.entityType === "organization") return "faction";
	if (item.entityType === "song") return "song";
	return "context";
}

function visualMark(kind: VisualKind): string {
	switch (kind) {
		case "hero":
			return "✦";
		case "character":
			return "N";
		case "location":
			return "⌖";
		case "faction":
			return "◇";
		case "song":
			return "♪";
		case "moment":
			return "◆";
		default:
			return "·";
	}
}

export function WorldEntityNode({ data, selected }: NodeProps<WorldFlowNode>) {
	const { item, isFocus, isHero, prominence, isDimmed } = data;
	const kind = visualKind(item, isHero);
	return (
		<div
			className={`${nodeStyles.entityNode} ${isHero ? nodeStyles.entityNodeHero : ""} ${isFocus ? nodeStyles.entityNodeFocus : ""} ${selected ? nodeStyles.entityNodeSelected : ""} ${isDimmed ? nodeStyles.entityNodeDimmed : ""}`}
			data-world-node={item.id}
			data-prominence={prominence}
			data-node-kind={kind}
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
							className={nodeStyles.hiddenHandle}
							isConnectable={false}
						/>,
						<Handle
							key={targetId}
							id={targetId}
							type="target"
							position={position}
							style={style}
							className={nodeStyles.hiddenHandle}
							isConnectable={false}
						/>,
					];
				}),
			)}
			<div className={nodeStyles.nodePortrait} aria-hidden="true">
				{item.imageUrl ? (
					<Image
						className={nodeStyles.nodeImage}
						src={item.imageUrl}
						alt=""
						fill
						sizes={isHero ? "116px" : "90px"}
					/>
				) : (
					<span className={nodeStyles.nodeInitials}>{initials(item.label)}</span>
				)}
				<span className={nodeStyles.nodeKindMark}>{visualMark(kind)}</span>
				{isHero ? <i className={nodeStyles.heroOrbit} /> : null}
			</div>
			<div className={nodeStyles.nodeLabel} data-node-label>
				{item.label}
			</div>
			{item.subtitle ? <div className={nodeStyles.nodeSubtitle}>{item.subtitle}</div> : null}
		</div>
	);
}
