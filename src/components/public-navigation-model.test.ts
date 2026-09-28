import { describe, expect, it } from "vitest";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import {
	isCurrentNavigationPath,
	PUBLIC_NAV_ITEMS,
	visibleToolNavigationItems,
} from "./public-navigation-model";

describe("global navigation model", () => {
	it("keeps the approved public destinations in a stable order", () => {
		expect(PUBLIC_NAV_ITEMS.map(({ href, label }) => [href, label])).toEqual([
			["/sessoes", "Sessões"],
			["/lembra", "Lembra"],
			["/lore", "Lores"],
			["/mundo", "Mundo"],
			["/personagens", "Personagens"],
			["/npcs", "NPCs"],
			["/lugares", "Lugares"],
			["/faccoes", "Facções"],
			["/quests", "Quests"],
			["/musicas", "Músicas"],
			["/diario", "Diários"],
		]);
	});

	it("matches destination roots and their subroutes without matching siblings", () => {
		expect(isCurrentNavigationPath("/mundo", "/mundo")).toBe(true);
		expect(isCurrentNavigationPath("/mundo/yuhara", "/mundo")).toBe(true);
		expect(isCurrentNavigationPath("/mundos", "/mundo")).toBe(false);
	});

	it("projects only tools backed by effective server capabilities", () => {
		expect(
			visibleToolNavigationItems([
				EDIT_CAPABILITIES.transcriptRead,
				EDIT_CAPABILITIES.localProcess,
			]).map((item) => item.label),
		).toEqual(["Transcrições", "Editar sessões", "Processar"]);

		const worldTools = visibleToolNavigationItems([EDIT_CAPABILITIES.worldLayoutEdit]);
		expect(worldTools.map(({ href, label }) => [href, label])).toEqual([
			["/mundo", "Editar mundo"],
		]);
		expect(worldTools.some((item) => item.href === "/edit/mundo")).toBe(false);

		expect(visibleToolNavigationItems([])).toEqual([]);
	});
});
