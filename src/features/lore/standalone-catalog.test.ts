import { describe, expect, it } from "vitest";
import { LORE_EDITORIAL_REGISTRY } from "./registry";
import {
	loreCatalogueEntries,
	listedLoreCatalogueEntries,
	listedStandaloneLores,
	standaloneLoreForEntity,
} from "./standalone-catalog";

describe("editorial lore catalogue", () => {
	it("uses one presentation catalogue for app and standalone curated entries", () => {
		expect(listedLoreCatalogueEntries().map((lore) => lore.slug)).toEqual([
			"astel",
			"noah",
			"pipipi",
			"seika",
			"d",
			"yllith",
		]);
		expect(listedStandaloneLores().map((lore) => lore.slug)).toEqual([
			"astel",
			"noah",
			"seika",
			"d",
			"yllith",
		]);
	});

	it("keeps catalogue metadata and the editorial registry in parity", () => {
		const catalogueSlugs = new Set(loreCatalogueEntries().map((lore) => lore.slug));
		for (const registration of LORE_EDITORIAL_REGISTRY) {
			if (registration.listed) {
				expect(
					catalogueSlugs.has(registration.slug),
					`listed lore ${registration.slug} must have catalogue metadata`,
				).toBe(true);
			}
		}
		for (const lore of loreCatalogueEntries()) {
			expect(
				LORE_EDITORIAL_REGISTRY.some(
					(registration) => registration.slug === lore.slug,
				),
				`catalogue lore ${lore.slug} must have an editorial registration`,
			).toBe(true);
		}
	});

	it("uses campaign-qualified character links instead of global slugs", () => {
		expect(standaloneLoreForEntity("yuhara-main", "pc", "astel")?.slug).toBe(
			"astel",
		);
		expect(standaloneLoreForEntity("yuhara-main", "pc", "noah")?.slug).toBe(
			"noah",
		);
		expect(standaloneLoreForEntity("campaign-b", "pc", "astel")).toBeNull();
		expect(standaloneLoreForEntity("yuhara-main", "npc", "astel")).toBeNull();
		expect(standaloneLoreForEntity("yuhara-main", "pc", "Noah Wood")).toBeNull();
		expect(standaloneLoreForEntity(undefined, "pc", "astel")).toBeNull();
	});
});
