import { describe, expect, it } from "vitest";
import {
	loreEntityTypesForRoute,
	loreHrefFor,
	loreIndexHref,
	loreRouteKindForEntity,
	primaryLoreEntityTypeForRoute,
	routeAcceptsLoreEntity,
} from "./routes";

describe("lore routes", () => {
	it("maps approved entity types to campaign-qualified editorial routes", () => {
		expect(loreHrefFor("pc", "dandelion", "cronicas-da-mesa")).toBe(
			"/campanhas/cronicas-da-mesa/personagens/dandelion",
		);
		expect(loreHrefFor("npc", "ivory", "campaign-b")).toBe(
			"/campanhas/campaign-b/npcs/ivory",
		);
		expect(loreHrefFor("location", "euclix", "campaign-b")).toBe(
			"/campanhas/campaign-b/lugares/euclix",
		);
		expect(loreHrefFor("song", "o-reino-vai-cantar", "campaign-b")).toBe(
			"/campanhas/campaign-b/musicas/o-reino-vai-cantar",
		);
	});

	it("keeps legacy paths available when no campaign route key is provided", () => {
		expect(loreIndexHref("personagens")).toBe("/personagens");
		expect(loreHrefFor("pc", "dandelion")).toBe("/personagens/dandelion");
	});

	it("keeps the same entity slug isolated by campaign route identity", () => {
		expect(loreHrefFor("pc", "same", "campaign-a")).toBe(
			"/campanhas/campaign-a/personagens/same",
		);
		expect(loreHrefFor("pc", "same", "campaign-b")).toBe(
			"/campanhas/campaign-b/personagens/same",
		);
	});

	it("keeps entity types without an approved public route unresolved", () => {
		expect(loreHrefFor("item", "espada-antiga", "campaign-a")).toBeNull();
		expect(loreHrefFor("concept", "o-veu", "campaign-a")).toBeNull();
		expect(loreRouteKindForEntity("item")).toBeNull();
	});

	it("exposes the catalog context for supported public entity types", () => {
		expect(loreRouteKindForEntity("pc")).toBe("personagens");
		expect(loreRouteKindForEntity("npc")).toBe("npcs");
		expect(loreRouteKindForEntity("location")).toBe("lugares");
		expect(loreRouteKindForEntity("faction")).toBe("faccoes");
		expect(loreRouteKindForEntity("quest")).toBe("quests");
		expect(loreRouteKindForEntity("song")).toBe("musicas");
		expect(primaryLoreEntityTypeForRoute("personagens")).toBe("pc");
		expect(loreEntityTypesForRoute("faccoes")).toEqual(["faction"]);
	});

	it("rejects mismatched route/entity combinations", () => {
		expect(routeAcceptsLoreEntity("personagens", "pc")).toBe(true);
		expect(routeAcceptsLoreEntity("personagens", "npc")).toBe(false);
	});
});
