"use client";

import {
	BaseEdge,
	EdgeLabelRenderer,
	ViewportPortal,
	getBezierPath,
	type EdgeProps,
	useInternalNode,
} from "@xyflow/react";
import type { WorldFlowEdge } from "../adapters/react-flow";
import {
	getFloatingEdgeGeometry,
	type FloatingNodeBox,
} from "../floating-edge-geometry";
import type { WorldLineStyle, WorldRelationFamily } from "../model";
import { getRoutedBezierPath } from "../routed-edge-geometry";
import { worldEdgeSemanticPresentation } from "../world-semantic-zoom";
import effects from "./relation-edge-effects.module.css";
import styles from "./world-explorer.module.css";
import { useWorldSemanticZoomTier } from "./world-semantic-zoom-context";

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

const STYLE_DASHES: Record<WorldLineStyle, string | undefined> = {
	solid: undefined,
	dashed: "7 5",
	dotted: "2 5",
};

type InternalNodeLike = {
	measured?: { width?: number; height?: number };
	internals?: { positionAbsolute?: { x: number; y: number } };
};

function relationCurvature(family: WorldRelationFamily, routeOffset: number): number {
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
	const semanticZoom = useWorldSemanticZoomTier();
	const sourceNode = useInternalNode(props.source);
	const targetNode = useInternalNode(props.target);
	const sourceBox = floatingBox(sourceNode);
	const targetBox = floatingBox(targetNode);
	const floatingRoute = props.data
		? {
				source:
					props.data.sourceSide !== undefined && props.data.sourceLane !== undefined
						? { side: props.data.sourceSide, lane: props.data.sourceLane }
						: undefined,
				target:
					props.data.targetSide !== undefined && props.data.targetLane !== undefined
						? { side: props.data.targetSide, lane: props.data.targetLane }
						: undefined,
			}
		: undefined;
	const floating =
		sourceBox && targetBox
			? getFloatingEdgeGeometry(sourceBox, targetBox, floatingRoute)
			: null;
	const routeOffset = props.data?.routeOffset ?? 28;
	const bendOffset = props.data?.bendOffset ?? 0;
	const labelOffset = props.data?.labelOffset ?? { x: 0, y: 0 };
	const family = props.data?.family ?? "context";
	const customStyle = props.data?.style;
	const curvature = relationCurvature(family, routeOffset);
	const sourceX = floating?.sourceX ?? props.sourceX;
	const sourceY = floating?.sourceY ?? props.sourceY;
	const targetX = floating?.targetX ?? props.targetX;
	const targetY = floating?.targetY ?? props.targetY;
	const sourcePosition = floating?.sourcePosition ?? props.sourcePosition;
	const targetPosition = floating?.targetPosition ?? props.targetPosition;
	const [path, labelX, labelY] =
		Math.abs(bendOffset) < 0.5
			? getBezierPath({
					sourceX,
					sourceY,
					sourcePosition,
					targetX,
					targetY,
					targetPosition,
					curvature,
				})
			: getRoutedBezierPath({
					sourceX,
					sourceY,
					sourcePosition,
					targetX,
					targetY,
					targetPosition,
					bendOffset,
				});
	const item = props.data?.item;
	const highlighted = props.data?.isHighlighted ?? false;
	const hovered = props.data?.isHovered ?? false;
	const active = highlighted || hovered || Boolean(props.selected);
	const dimmed = props.data?.isDimmed ?? false;
	const semantic = worldEdgeSemanticPresentation(semanticZoom, {
		highlighted: active,
		dimmed,
	});
	const stroke = customStyle?.color ?? RELATION_STROKES[family];
	const motionStroke = RELATION_MOTION_STROKES[family];
	const baseWidth = customStyle?.lineWidth ?? 3;
	const strokeWidth =
		(active ? baseWidth + 0.6 : baseWidth) * semantic.strokeWidthScale;
	const strokeOpacity = semantic.strokeOpacity;
	const dash = customStyle
		? STYLE_DASHES[customStyle.lineStyle]
		: RELATION_DASHES[family];

	// Keep interaction in React Flow's native edge SVG, but paint the visible
	// relation inside ViewportPortal. The portal shares the viewport transform
	// with nodes, so it does not drift during pan/zoom like EdgeLabelRenderer,
	// while avoiding the Chromium paint failure previously observed in the native
	// edge SVG composition.
	const paintPadding = Math.max(120, routeOffset * 3, Math.abs(bendOffset) + 80);
	const paintLeft = Math.min(sourceX, targetX) - paintPadding;
	const paintTop = Math.min(sourceY, targetY) - paintPadding;
	const paintWidth = Math.max(1, Math.abs(targetX - sourceX) + paintPadding * 2);
	const paintHeight = Math.max(1, Math.abs(targetY - sourceY) + paintPadding * 2);

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
			<ViewportPortal>
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
						zIndex: 1,
					}}
					aria-hidden="true"
					data-world-edge-paint-layer={props.id}
				>
					{semantic.showHalo ? (
						<path
							d={path}
							fill="none"
							stroke="var(--ds-canvas)"
							strokeWidth={strokeWidth + 3}
							strokeOpacity={dimmed ? 0.04 : active ? 0.7 : 0.3}
							strokeDasharray={dash}
							vectorEffect="non-scaling-stroke"
							strokeLinecap="round"
							pointerEvents="none"
							data-world-edge-halo={props.id}
						/>
					) : null}
					<path
						d={path}
						fill="none"
						stroke={stroke}
						strokeWidth={strokeWidth}
						strokeOpacity={strokeOpacity}
						strokeDasharray={dash}
						vectorEffect="non-scaling-stroke"
						strokeLinecap="round"
						markerEnd={props.markerEnd}
						pointerEvents="none"
						data-family={family}
						data-edge-curve="bezier"
						data-edge-anchor={floating ? "floating" : "handle"}
						data-edge-bend={bendOffset}
						data-world-edge-active={active ? "true" : "false"}
						data-world-edge={props.id}
						data-world-semantic-zoom={semanticZoom}
					/>
					{semantic.showMotion && active && !dimmed ? (
						<path
							d={path}
							className={effects.flowMotion}
							fill="none"
							stroke={motionStroke}
							strokeWidth={Math.max(2, Math.min(3.4, baseWidth - 0.2))}
							strokeOpacity={0.98}
							strokeDasharray="1 11"
							strokeDashoffset="0"
							vectorEffect="non-scaling-stroke"
							strokeLinecap="round"
							pointerEvents="none"
							data-family={family}
							data-motion-contrast="bright"
							data-world-edge-motion={props.id}
						/>
					) : null}
				</svg>
			</ViewportPortal>
			<EdgeLabelRenderer>
				{item && semantic.showLabel ? (
					<div
						className={`${styles.edgeLabel} ${active ? styles.edgeLabelHighlighted : ""}`}
						data-family={family}
						data-world-edge-label={props.id}
						aria-hidden="true"
						style={{
							transform: `translate(-50%, -50%) translate(${labelX + labelOffset.x}px, ${labelY + labelOffset.y}px) scale(var(--world-label-counter-scale, 1))`,
							transformOrigin: "50% 50%",
						}}
					>
						{item.label}
					</div>
				) : null}
			</EdgeLabelRenderer>
		</>
	);
}
