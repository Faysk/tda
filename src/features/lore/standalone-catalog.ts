import catalog from "./standalone-catalog.json";
import { loreRegistrationForSlug } from "./registry";

export function listedStandaloneLores() {
	return catalog.filter(
		(lore) => loreRegistrationForSlug(lore.slug)?.listed === true,
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
				registration?.entityLink?.campaignTechnicalSlug ===
					campaignTechnicalSlug &&
				registration.entityLink.entityType === entityType &&
				registration.entityLink.entitySlug === slug,
		);
	return registration?.lore ?? null;
}
