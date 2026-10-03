import { describe, expect, it } from "vitest";
import { campaignOverviewNarrativeLinksFromEntityTypes } from "./overview";

describe("campaignOverviewNarrativeLinksFromEntityTypes", () => {
	it("projects only supported public narrative categories in stable order", () => {
		expect(
			campaignOverviewNarrativeLinksFromEntityTypes("mesa-a", [
				"quest",
				"pc",
				"location",
				"faction",
				"song",
				"npc",
				"item",
				"concept",
			]),
		).toEqual([
			{
				routeKind: "personagens",
				label: "Personagens",
				href: "/campanhas/mesa-a/personagens",
			},
			{
				routeKind: "npcs",
				label: "NPCs",
				href: "/campanhas/mesa-a/npcs",
			},
			{
				routeKind: "lugares",
				label: "Lugares",
				href: "/campanhas/mesa-a/lugares",
			},
			{
				routeKind: "faccoes",
				label: "Facções",
				href: "/campanhas/mesa-a/faccoes",
			},
			{
				routeKind: "quests",
				label: "Quests",
				href: "/campanhas/mesa-a/quests",
			},
			{
				routeKind: "musicas",
				label: "Músicas",
				href: "/campanhas/mesa-a/musicas",
			},
		]);
	});

	it("deduplicates shared route categories and does not invent unsupported links", () => {
		expect(
			campaignOverviewNarrativeLinksFromEntityTypes("mesa-b", [
				"organization",
				"faction",
				"arc",
				"concept",
				"item",
			]),
		).toEqual([
			{
				routeKind: "faccoes",
				label: "Facções",
				href: "/campanhas/mesa-b/faccoes",
			},
		]);
	});
});
