import "server-only";
import type { LoreProfileDTO, LoreRouteKind } from "./model";

/**
 * Public lore projection boundary.
 *
 * Deliberately empty until an authorized entity/canon/media projection exists.
 * Test fixtures live outside this repository boundary and are never published by it.
 */
export async function findPublishedLoreProfile(
	_routeKind: LoreRouteKind,
	_slug: string,
): Promise<LoreProfileDTO | null> {
	return null;
}
