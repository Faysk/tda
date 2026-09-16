import type { LoreEntityType } from "@/features/lore/model";
import { loreHrefFor } from "@/features/lore/routes";
import type { WorldEntityType, WorldVisibility } from "./model";

function asLoreEntityType(entityType: WorldEntityType): LoreEntityType | null {
	return entityType === "other" ? null : entityType;
}

export function worldPublicProfileRoute({
	entityType,
	slug,
	status,
	visibility,
}: {
	entityType: WorldEntityType;
	slug: string | null;
	status: string | null | undefined;
	visibility: WorldVisibility | string | null | undefined;
}): string | undefined {
	if (!slug || status !== "active" || visibility !== "public_web") return undefined;
	const loreEntityType = asLoreEntityType(entityType);
	if (!loreEntityType) return undefined;
	return loreHrefFor(loreEntityType, slug) ?? undefined;
}
