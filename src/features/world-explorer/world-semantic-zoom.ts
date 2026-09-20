export type WorldSemanticZoomTier = "atlas" | "region" | "detail";

export const WORLD_CANVAS_MIN_ZOOM = 0.08;
export const WORLD_CANVAS_MAX_ZOOM = 2.2;
export const WORLD_ATLAS_MAX_ZOOM = 0.34;
export const WORLD_REGION_MAX_ZOOM = 0.72;

/**
 * Semantic zoom is presentation-only. It never changes the authorized graph;
 * it only controls how much visual detail is painted at each camera scale.
 */
export function worldSemanticZoomTier(zoom: number): WorldSemanticZoomTier {
	if (!Number.isFinite(zoom) || zoom >= WORLD_REGION_MAX_ZOOM) return "detail";
	if (zoom < WORLD_ATLAS_MAX_ZOOM) return "atlas";
	return "region";
}

/**
 * React Flow scales node contents with the viewport. Map-like labels should
 * remain legible while zooming out, but still have a cap so the overview does
 * not turn into a wall of text.
 */
export function worldLabelCounterScale(zoom: number): number {
	if (!Number.isFinite(zoom) || zoom <= 0) return 1;
	return Math.min(5.6, Math.max(1, 1 / Math.max(zoom, 0.18)));
}

export type WorldNodeSemanticPresentation = Readonly<{
	showLabel: boolean;
	showSubtitle: boolean;
	showKindMark: boolean;
}>;

export function worldNodeSemanticPresentation(
	tier: WorldSemanticZoomTier,
	input: Readonly<{
		isHero: boolean;
		isFocus: boolean;
		selected: boolean;
		prominence: "hero" | "primary" | "supporting" | "context";
		authoringConnectable: boolean;
	}>,
): WorldNodeSemanticPresentation {
	const forced = input.selected || input.isFocus || input.authoringConnectable;

	if (tier === "detail") {
		return {
			showLabel: true,
			showSubtitle: true,
			showKindMark: true,
		};
	}

	if (tier === "region") {
		return {
			showLabel:
				forced || input.isHero || input.prominence === "primary",
			showSubtitle: input.selected || input.isFocus,
			showKindMark: forced || input.isHero || input.prominence === "primary",
		};
	}

	return {
		showLabel: forced || input.isHero,
		showSubtitle: false,
		showKindMark: forced || input.isHero,
	};
}

export type WorldEdgeSemanticPresentation = Readonly<{
	strokeOpacity: number;
	strokeWidthScale: number;
	showHalo: boolean;
	showLabel: boolean;
	showMotion: boolean;
}>;

export function worldEdgeSemanticPresentation(
	tier: WorldSemanticZoomTier,
	input: Readonly<{ highlighted: boolean; dimmed: boolean }>,
): WorldEdgeSemanticPresentation {
	if (input.highlighted && !input.dimmed) {
		return {
			strokeOpacity: 1,
			strokeWidthScale: tier === "atlas" ? 0.82 : tier === "region" ? 0.92 : 1,
			showHalo: tier !== "atlas",
			showLabel: true,
			showMotion: tier === "detail",
		};
	}

	if (tier === "atlas") {
		return {
			strokeOpacity: input.dimmed ? 0.035 : 0.2,
			strokeWidthScale: 0.46,
			showHalo: false,
			showLabel: false,
			showMotion: false,
		};
	}

	if (tier === "region") {
		return {
			strokeOpacity: input.dimmed ? 0.07 : 0.5,
			strokeWidthScale: 0.72,
			showHalo: false,
			showLabel: false,
			showMotion: false,
		};
	}

	return {
		strokeOpacity: input.dimmed ? 0.12 : 0.94,
		strokeWidthScale: 1,
		showHalo: true,
		showLabel: !input.dimmed,
		showMotion: false,
	};
}
