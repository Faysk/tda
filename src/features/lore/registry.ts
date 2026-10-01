import type { LoreEntityType } from "./model";

export type LoreDelivery = "app" | "standalone";

export type LoreEntityLink = Readonly<{
	campaignTechnicalSlug: string;
	entityType: LoreEntityType;
	entitySlug: string;
}>;

export type LoreEditorialRegistration = Readonly<{
	slug: string;
	delivery: LoreDelivery;
	listed: boolean;
	campaignTechnicalSlug: string | null;
	indexable: boolean;
	entityLink: LoreEntityLink | null;
}>;

/**
 * Editorial state only. This registry never creates campaign/entity/canon rows and
 * never copies narrative text. A campaignTechnicalSlug is a desired editorial
 * binding that becomes resolved only when the campaign row exists.
 */
export const LORE_EDITORIAL_REGISTRY = [
	{
		slug: "pipipi", delivery: "app", listed: true,
		campaignTechnicalSlug: "yuhara-main", indexable: true, entityLink: null,
	},
	{
		slug: "astel", delivery: "standalone", listed: true,
		campaignTechnicalSlug: null, indexable: true,
		entityLink: { campaignTechnicalSlug: "yuhara-main", entityType: "pc", entitySlug: "astel" },
	},
	{
		slug: "noah", delivery: "standalone", listed: true,
		campaignTechnicalSlug: null, indexable: true,
		entityLink: { campaignTechnicalSlug: "yuhara-main", entityType: "pc", entitySlug: "noah" },
	},
	{
		slug: "d", delivery: "standalone", listed: false,
		campaignTechnicalSlug: "antes-que-seja-tarde", indexable: false, entityLink: null,
	},
	{
		slug: "seika", delivery: "standalone", listed: true,
		campaignTechnicalSlug: "antes-que-seja-tarde", indexable: false, entityLink: null,
	},
	{
		slug: "yllith", delivery: "standalone", listed: false,
		campaignTechnicalSlug: null, indexable: false, entityLink: null,
	},
] as const satisfies readonly LoreEditorialRegistration[];

export function loreRegistrationForSlug(
	slug: string,
): LoreEditorialRegistration | null {
	return LORE_EDITORIAL_REGISTRY.find((lore) => lore.slug === slug) ?? null;
}
