export type CinematicFocalPoint = Readonly<{
	x: number;
	y: number;
}>;

export type CinematicMotionScale = Readonly<{
	backgroundX: number;
	backgroundY: number;
	subjectX: number;
	subjectY: number;
	scale: number;
}>;

/**
 * Visual-only direction for a cinematic scene.
 * Narrative/canon must never live in this object.
 */
export type CinematicSceneArtDirection = Readonly<{
	focalPoint: CinematicFocalPoint;
	mobileFocalPoint?: CinematicFocalPoint;
	mobileMotion?: Partial<CinematicMotionScale>;
	/**
	 * Freezes background and subject transforms while preserving the scene's
	 * sticky storytelling and copy reveal. Use this when the approved artwork
	 * already has a strong composition that parallax would only disturb.
	 */
	staticMedia?: boolean;
}>;

/**
 * Mobile keeps depth, but aggressively reduces crop drift.
 * Horizontal background travel is nearly removed because portrait cover crops
 * have very little safe width to spend on parallax.
 */
export const DEFAULT_MOBILE_CINEMATIC_MOTION: CinematicMotionScale = {
	backgroundX: 0.08,
	backgroundY: 0.32,
	subjectX: 0.18,
	subjectY: 0.28,
	scale: 0.3,
};
