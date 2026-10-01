import catalog from "./standalone-catalog.json";
import { loreRegistrationForSlug } from "./registry";

export type LoreCatalogueEntry = (typeof catalog)[number];

export function loreCatalogueEntries(): readonly LoreCatalogueEntry[] {
	return catalog;
}

export function listedLoreCatalogueEntries(): readonly LoreCatalogueEntry[] {
	return catalog.filter(
		(lore) => loreRegistrationForSlug(lore.slug)?.listed === true,
	);
}

/**
 * Backward-compatible helper for consumers that specifically need standalone
 * delivery. The public /lore index uses listedLoreCatalogueEntries so app and
 * standalone experiences share one curation source.
 */
export function listedStandaloneLores(): readonly LoreCatalogueEntry[] {
	return listedLoreCatalogueEntries().filter(
		(lore) => loreRegistrationForSlug(lore.slug)?.delivery === "standalone",
	);
}

/**
 * Editorial links only; never changes an entity's profile route or canon.
 * The entity link is campaign-qualified so an equal slug in another campaign
 * cannot inherit a standalone lore accidentally.
 */
export function standaloneLoreForEntity(
	campaignTechnicalSlug: string | undefined,
	entityType: string | undefined,
	slug: string | null,
) {
	if (!campaignTechnicalSlug || !entityType || !slug) return null;
	const registration = catalog
		.map((lore) => ({
			lore,
			registration: loreRegistrationForSlug(lore.slug),
		}))
		.find(
			({ registration }) =>
				registration?.delivery === "standalone" &&
				registration.entityLink?.campaignTechnicalSlug ===
					campaignTechnicalSlug &&
				registration.entityLink.entityType === entityType &&
				registration.entityLink.entitySlug === slug,
		);
	return registration?.lore ?? null;
}
