"use client";

import { ViewportPortal } from "@xyflow/react";
import { useMemo } from "react";
import type { WorldFlowNode } from "../adapters/react-flow";
import { deriveWorldVisualNeighborhoods } from "../world-neighborhoods";
import styles from "./world-neighborhoods.module.css";
import { useWorldSemanticZoomTier } from "./world-semantic-zoom-context";

export function WorldNeighborhoodOverlay({
	nodes,
}: {
	nodes: readonly WorldFlowNode[];
}) {
	const semanticZoom = useWorldSemanticZoomTier();
	const neighborhoods = useMemo(
		() => deriveWorldVisualNeighborhoods(nodes),
		[nodes],
	);

	if (semanticZoom === "detail" || neighborhoods.length === 0) return null;

	return (
		<ViewportPortal>
			<div
				className={styles.layer}
				data-world-neighborhood-layer
				data-world-semantic-zoom={semanticZoom}
				aria-hidden="true"
			>
				{neighborhoods.map((neighborhood) => (
					<div
						key={neighborhood.id}
						className={styles.region}
						style={{
							left: neighborhood.x,
							top: neighborhood.y,
							width: neighborhood.width,
							height: neighborhood.height,
						}}
						data-world-neighborhood={neighborhood.id}
					>
						<div className={styles.label}>
							<strong>{neighborhood.label}</strong>
							<span>{neighborhood.nodeCount} ecos</span>
						</div>
					</div>
				))}
			</div>
		</ViewportPortal>
	);
}
