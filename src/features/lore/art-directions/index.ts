import type { LorePresentationInput } from "../model";

/**
 * Versioned visual direction only. Narrative text/canon never lives here.
 */
const loreArtDirections: Record<string, LorePresentationInput> = {};

export function findLoreArtDirection(
	slug: string,
): LorePresentationInput | undefined {
	return loreArtDirections[slug];
}
