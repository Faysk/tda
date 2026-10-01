import { describe, expect, it } from "vitest";
import {
	listedStandaloneLores,
	standaloneLoreForEntity,
} from "./standalone-catalog";

describe("editorial lore links", () => {
	it("keeps curated listing independent from campaign linkage", () => {
		expect(listedStandaloneLores().map((lore) => lore.slug)).toEqual([
			"astel",
			"noah",
		]);
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
