export const LORE_SECTION_IDS = [
	"overview",
	"canon",
	"relations",
	"moments",
	"timeline",
	"sessions",
	"music",
	"gallery",
] as const;

export type LoreSectionId = (typeof LORE_SECTION_IDS)[number];

export type LoreEntityType =
	| "pc"
	| "npc"
	| "location"
	| "item"
	| "organization"
	| "faction"
	| "arc"
	| "concept"
	| "song"
	| "quest";

export type LoreRouteKind =
	| "personagens"
	| "npcs"
	| "lugares"
	| "faccoes"
	| "musicas"
	| "quests";

export type LoreMotionPreset =
	| "still"
	| "cinematic-soft"
	| "cinematic-push"
	| "cinematic-pan-left"
	| "cinematic-pan-right"
	| "mystical-float"
	| "dark-breath"
	| "battle-drift";

export type LoreAtmosphereKind = "fog" | "dust" | "embers" | "rain";

export type LoreMediaDTO = {
	src: string;
	alt: string;
	width?: number;
	height?: number;
};

export type LoreLayerRole =
	| "background"
	| "midground"
	| "subject"
	| "foreground"
	| "atmosphere";

export type LoreLayer = {
	id: string;
	src: string;
	role: LoreLayerRole;
	depth: number;
	alt?: string;
	opacity?: number;
	blur?: number;
	scale?: number;
	offsetX?: number;
	offsetY?: number;
	objectPosition?: {
		x: number;
		y: number;
	};
	blendMode?: "normal" | "screen" | "multiply" | "overlay" | "soft-light";
};

export type LoreMotionPresentation = {
	preset: LoreMotionPreset;
	intensity: number;
	pointerParallax: boolean;
	scrollParallax: boolean;
};

export type LoreAtmospherePresentation = {
	effects: LoreAtmosphereKind[];
	intensity: number;
};

export type LoreHeroPresentation = {
	mode: "standard" | "parallax" | "cinematic";
	poster?: LoreMediaDTO;
	layers: LoreLayer[];
	focalPoint: {
		x: number;
		y: number;
	};
	height: "compact" | "standard" | "immersive";
	overlay: "none" | "soft" | "strong";
	initialSceneId?: string;
};

export type LoreScenePresentation = {
	id: string;
	poster?: LoreMediaDTO;
	layers?: LoreLayer[];
	focalPoint?: {
		x: number;
		y: number;
	};
	overlay?: LoreHeroPresentation["overlay"];
	motion?: Partial<LoreMotionPresentation>;
	atmosphere?: Partial<LoreAtmospherePresentation>;
};

export type LorePresentation = {
	hero: LoreHeroPresentation;
	motion: LoreMotionPresentation;
	atmosphere: LoreAtmospherePresentation;
	scenes: LoreScenePresentation[];
	accent?: string;
};

export type LorePresentationInput = {
	hero?: Partial<LoreHeroPresentation>;
	motion?: Partial<LoreMotionPresentation>;
	atmosphere?: Partial<LoreAtmospherePresentation>;
	scenes?: LoreScenePresentation[];
	accent?: string;
};

export type LoreIdentityDTO = {
	id: string;
	slug: string;
	entityType: LoreEntityType;
	name: string;
	eyebrow?: string;
	epithet?: string;
	summary?: string;
	status?: string;
	tags?: string[];
	quote?: {
		text: string;
		attribution?: string;
	};
};

export type LoreFactDTO = {
	label: string;
	value: string;
};

export type LoreCardDTO = {
	id: string;
	title: string;
	summary?: string;
	eyebrow?: string;
	image?: LoreMediaDTO;
	href?: string;
};

export type LoreLinkDTO = {
	id: string;
	label: string;
	description?: string;
	href: string;
};

type LoreBlockBase = {
	id: string;
};

export type LoreBlockDTO =
	| (LoreBlockBase & {
			kind: "prose";
			paragraphs: string[];
	  })
	| (LoreBlockBase & {
			kind: "quote";
			text: string;
			attribution?: string;
	  })
	| (LoreBlockBase & {
			kind: "facts";
			items: LoreFactDTO[];
	  })
	| (LoreBlockBase & {
			kind: "cards";
			items: LoreCardDTO[];
	  })
	| (LoreBlockBase & {
			kind: "links";
			items: LoreLinkDTO[];
	  })
	| (LoreBlockBase & {
			kind: "gallery";
			items: LoreMediaDTO[];
	  });

export type LoreSectionDTO = {
	id: LoreSectionId;
	title: string;
	eyebrow?: string;
	intro?: string;
	blocks: LoreBlockDTO[];
};

export type LoreNarrationBeatDTO = {
	id: string;
	startMs: number;
	endMs: number;
	subtitle: string;
	sceneId?: string;
};

/**
 * Editorial narration authored for a lore profile.
 * This is intentionally distinct from raw/heavy session audio, which remains local.
 */
export type LoreNarrationDTO = {
	id: string;
	kind: "editorial-narration";
	src: string;
	title?: string;
	durationMs?: number;
	beats: LoreNarrationBeatDTO[];
};

export type LoreProfileDTO = {
	identity: LoreIdentityDTO;
	presentation: LorePresentation;
	sections: LoreSectionDTO[];
	narration?: LoreNarrationDTO;
	worldHref?: string;
};
