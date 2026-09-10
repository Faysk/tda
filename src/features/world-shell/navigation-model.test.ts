import { describe, expect, it } from "vitest";
import { WORLD_NAV_ITEMS, worldNavItemIsCurrent } from "./navigation-model";

describe("World navigation model", () => {
	it("keeps the workspace entry canonical and unique", () => {
		expect(WORLD_NAV_ITEMS.filter((item) => item.href === "/mundo")).toHaveLength(1);
		expect(WORLD_NAV_ITEMS.map((item) => item.href)).toEqual([
			"/mundo",
			"/personagens",
			"/npcs",
			"/lugares",
			"/faccoes",
			"/musicas",
		]);
	});

	it("matches nested typed routes without treating every world route as /mundo", () => {
		expect(worldNavItemIsCurrent("/mundo", "/mundo")).toBe(true);
		expect(worldNavItemIsCurrent("/mundo/qualquer-coisa", "/mundo")).toBe(false);
		expect(worldNavItemIsCurrent("/personagens/dandelion", "/personagens")).toBe(true);
		expect(worldNavItemIsCurrent("/npcs/ivory", "/npcs")).toBe(true);
		expect(worldNavItemIsCurrent("/lugares/euclix", "/lugares")).toBe(true);
	});
});
