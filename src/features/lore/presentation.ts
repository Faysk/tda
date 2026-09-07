import type {
	LoreAtmospherePresentation,
	LoreHeroPresentation,
	LoreMotionPresentation,
	LoreMotionPreset,
	LorePresentation,
	LorePresentationInput,
	LoreScenePresentation,
} from "./model";

export type LoreMotionPresetDefinition = {
	pointerAmplitudeX: number;
	pointerAmplitudeY: number;
	layerScaleBoost: number;
};

export const LORE_MOTION_PRESETS: Record<
	LoreMotionPreset,
	LoreMotionPresetDefinition
> = {
	still: { pointerAmplitudeX: 0, pointerAmplitudeY: 0, layerScaleBoost: 0 },
	"cinematic-soft": {
		pointerAmplitudeX: 14,
		pointerAmplitudeY: 8,
		layerScaleBoost: 0.012,
	},
	"cinematic-push": {
		pointerAmplitudeX: 18,
		pointerAmplitudeY: 10,
		layerScaleBoost: 0.018,
	},
	"cinematic-pan-left": {
		pointerAmplitudeX: 22,
		pointerAmplitudeY: 8,
		layerScaleBoost: 0.014,
	},
	"cinematic-pan-right": {
		pointerAmplitudeX: 22,
		pointerAmplitudeY: 8,
		layerScaleBoost: 0.014,
	},
	"mystical-float": {
		pointerAmplitudeX: 16,
		pointerAmplitudeY: 14,
		layerScaleBoost: 0.016,
	},
	"dark-breath": {
		pointerAmplitudeX: 12,
		pointerAmplitudeY: 7,
		layerScaleBoost: 0.02,
	},
	"battle-drift": {
		pointerAmplitudeX: 25,
		pointerAmplitudeY: 12,
		layerScaleBoost: 0.022,
	},
};

const defaultMotion: LoreMotionPresentation = {
	preset: "cinematic-soft",
	intensity: 1,
	pointerParallax: true,
	scrollParallax: false,
};

export const DEFAULT_LORE_PRESENTATION: LorePresentation = {
	hero: {
		mode: "standard",
		layers: [],
		focalPoint: { x: 50, y: 42 },
		height: "standard",
		overlay: "strong",
	},
	motion: defaultMotion,
	atmosphere: {
		effects: [],
		intensity: 0.5,
	},
	scenes: [],
};

export function resolveLorePresentation(
	input?: LorePresentationInput,
): LorePresentation {
	return {
		hero: {
			...DEFAULT_LORE_PRESENTATION.hero,
			...input?.hero,
			focalPoint: {
				...DEFAULT_LORE_PRESENTATION.hero.focalPoint,
				...input?.hero?.focalPoint,
			},
			layers: input?.hero?.layers ?? DEFAULT_LORE_PRESENTATION.hero.layers,
		},
		motion: {
			...defaultMotion,
			...input?.motion,
		},
		atmosphere: {
			...DEFAULT_LORE_PRESENTATION.atmosphere,
			...input?.atmosphere,
			effects:
				input?.atmosphere?.effects ?? DEFAULT_LORE_PRESENTATION.atmosphere.effects,
		},
		scenes: input?.scenes ?? [],
		...(input?.accent ? { accent: input.accent } : {}),
	};
}

export function resolveLoreMotionDefinition(
	motion: LoreMotionPresentation,
): LoreMotionPresetDefinition {
	const preset = LORE_MOTION_PRESETS[motion.preset];
	const intensity = Math.max(0, Math.min(motion.intensity, 2));

	return {
		pointerAmplitudeX: preset.pointerAmplitudeX * intensity,
		pointerAmplitudeY: preset.pointerAmplitudeY * intensity,
		layerScaleBoost: preset.layerScaleBoost * intensity,
	};
}

export type ResolvedLoreScene = {
	hero: LoreHeroPresentation;
	motion: LoreMotionPresentation;
	atmosphere: LoreAtmospherePresentation;
};

function findScene(
	presentation: LorePresentation,
	sceneId?: string | null,
): LoreScenePresentation | undefined {
	if (!sceneId) return undefined;
	return presentation.scenes.find((scene) => scene.id === sceneId);
}

export function resolveLoreScene(
	presentation: LorePresentation,
	sceneId?: string | null,
): ResolvedLoreScene {
	const scene = findScene(presentation, sceneId);
	if (!scene) {
		return {
			hero: presentation.hero,
			motion: presentation.motion,
			atmosphere: presentation.atmosphere,
		};
	}

	return {
		hero: {
			...presentation.hero,
			...(scene.poster ? { poster: scene.poster } : {}),
			layers: scene.layers ?? presentation.hero.layers,
			focalPoint: scene.focalPoint ?? presentation.hero.focalPoint,
			overlay: scene.overlay ?? presentation.hero.overlay,
		},
		motion: {
			...presentation.motion,
			...scene.motion,
		},
		atmosphere: {
			...presentation.atmosphere,
			...scene.atmosphere,
			effects:
				scene.atmosphere?.effects ?? presentation.atmosphere.effects,
		},
	};
}
