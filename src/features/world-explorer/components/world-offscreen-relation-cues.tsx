"use client";

import {
	worldOffscreenCueTransform,
	type WorldOffscreenBoundary,
} from "../offscreen-relation-cues";
import styles from "./world-offscreen-relation-cues.module.css";

export type WorldOffscreenRelationCue = Readonly<{
	edgeId: string;
	targetId: string;
	targetLabel: string;
	relationLabel: string;
	x: number;
	y: number;
	boundary: WorldOffscreenBoundary;
}>;

export function WorldOffscreenRelationCues({
	cues,
	onNavigate,
}: Readonly<{
	cues: readonly WorldOffscreenRelationCue[];
	onNavigate: (targetId: string) => void;
}>) {
	if (!cues.length) return null;

	return (
		<div className={styles.layer} data-testid="world-offscreen-relation-cues">
			{cues.map((cue) => (
				<button
					key={cue.edgeId}
					type="button"
					className={styles.cue}
					data-world-offscreen-edge={cue.edgeId}
					data-world-offscreen-target={cue.targetId}
					data-world-offscreen-boundary={cue.boundary}
					style={{
						left: cue.x,
						top: cue.y,
						transform: worldOffscreenCueTransform(cue.boundary),
					}}
					aria-label={cue.relationLabel + ": mostrar " + cue.targetLabel}
					onClick={() => onNavigate(cue.targetId)}
				>
					<span className={styles.arrow} aria-hidden="true">›</span>
					<span className={styles.label}>{cue.targetLabel}</span>
				</button>
			))}
		</div>
	);
}
