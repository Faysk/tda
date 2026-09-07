import { describe, expect, it } from "vitest";
import {
	loreEntityTypesForRoute,
	loreHrefFor,
	routeAcceptsLoreEntity,
} from "./routes";

describe("lore routes", () => {
	it("maps approved entity types to editorial routes", () => {
		expect(loreHrefFor("pc", "dandelion")).toBe("/personagens/dandelion");
		expect(loreHrefFor("npc", "ivory")).toBe("/npcs/ivory");
		expect(loreHrefFor("location", "euclix")).toBe("/lugares/euclix");
		expect(loreHrefFor("song", "o-reino-vai-cantar")).toBe(
			"/musicas/o-reino-vai-cantar",
		);
	});

	it("keeps entity types without an approved public route unresolved", () => {
		expect(loreHrefFor("item", "espada-antiga")).toBeNull();
		expect(loreHrefFor("concept", "o-veu")).toBeNull();
	});

	it("rejects mismatched route/entity combinations", () => {
		expect(routeAcceptsLoreEntity("personagens", "pc")).toBe(true);
		expect(routeAcceptsLoreEntity("personagens", "npc")).toBe(false);
		expect(loreEntityTypesForRoute("faccoes")).toEqual(["faction"]);
	});
});
