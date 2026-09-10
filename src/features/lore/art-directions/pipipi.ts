import type { PipipiSceneId } from "../pipipi-story";
import type { CinematicSceneArtDirection } from "./cinematic";

/**
 * Versioned visual direction for Pipipi's cinematic scenes.
 * These coordinates describe framing only; they are not narrative assertions.
 */
export const PIPIPI_CINEMATIC_ART_DIRECTION: Record<
	PipipiSceneId,
	CinematicSceneArtDirection
> = {
	casa: {
		focalPoint: { x: 50, y: 50 },
		mobileFocalPoint: { x: 54, y: 50 },
	},
	"super-herois": {
		focalPoint: { x: 50, y: 50 },
		mobileFocalPoint: { x: 50, y: 50 },
		staticMedia: true,
	},
	corredores: {
		focalPoint: { x: 50, y: 50 },
		mobileFocalPoint: { x: 50, y: 50 },
		mobileMotion: {
			backgroundX: 0,
			backgroundY: 0.22,
			subjectX: 0.12,
			subjectY: 0.2,
			scale: 0.2,
		},
	},
	cadeira: {
		focalPoint: { x: 50, y: 50 },
		// The portrait crop intentionally favors the mother's chair; Pipipi is a
		// separate foreground layer and remains visible on the left.
		mobileFocalPoint: { x: 72, y: 50 },
		staticMedia: true,
	},
	"ultimo-dia": {
		focalPoint: { x: 50, y: 50 },
		// Current portrait composition is already strong; preserve it exactly
		// while scrolling instead of spending crop room on decorative parallax.
		mobileFocalPoint: { x: 50, y: 50 },
		staticMedia: true,
	},
	acordou: {
		focalPoint: { x: 50, y: 50 },
		mobileFocalPoint: { x: 51, y: 50 },
		mobileMotion: {
			backgroundX: 0,
			backgroundY: 0.2,
			subjectX: 0.08,
			subjectY: 0.16,
			scale: 0.18,
		},
	},
};
