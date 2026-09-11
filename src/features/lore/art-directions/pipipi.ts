import type { PipipiSceneId } from "../pipipi-story";
import type { CinematicSceneArtDirection } from "./cinematic";

/**
 * Versioned visual direction for Pipipi's cinematic scenes.
 * These coordinates describe framing only; they are not narrative assertions.
 *
 * The three hospital-bed compositions are deliberately single-frame scenes.
 * Keep staticMedia enabled so scroll/motion never changes the approved framing.
 * Their flattened rasters are media masters for that presentation and must be
 * replaced by higher-resolution equivalents when the source master is available;
 * never switch to a different composition merely to hide a resolution problem.
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
		mobileFocalPoint: { x: 72, y: 50 },
		staticMedia: true,
	},
	"ultimo-dia": {
		focalPoint: { x: 50, y: 50 },
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
