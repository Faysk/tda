import { describe, expect, it } from "vitest";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import {
	campaignTechnicalSlugFromLocation,
	isCurrentNavigationPath,
	locationHasCampaignReference,
	PUBLIC_NAV_ITEMS,
	toolNavigationItemsForCampaign,
	visibleToolNavigationItems,
} from "./public-navigation-model";

describe("global navigation model", () => {
	it("keeps the approved public destinations in a stable order", () => {
		expect(PUBLIC_NAV_ITEMS.map(({ href, label }) => [href, label])).toEqual([
			["/campanhas", "Campanhas"],
			["/campanhas/sessoes", "Sessões"],
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

	it("matches aggregate and campaign-scoped routes without double-highlighting Campanhas", () => {
		expect(isCurrentNavigationPath("/campanhas", "/campanhas")).toBe(true);
		expect(
			isCurrentNavigationPath(
				"/campanhas/cronicas-da-mesa/sessoes/42",
				"/campanhas/sessoes",
			),
		).toBe(true);
		expect(
			isCurrentNavigationPath(
				"/campanhas/cronicas-da-mesa/sessoes/42",
				"/campanhas",
			),
		).toBe(false);
		expect(
			isCurrentNavigationPath(
				"/campanhas/cronicas-da-mesa/mundo",
				"/mundo",
			),
		).toBe(true);
		expect(isCurrentNavigationPath("/mundos", "/mundo")).toBe(false);
	});

	it("builds only campaign-safe tool destinations", () => {
		const legacy = toolNavigationItemsForCampaign("yuhara-main", [
			EDIT_CAPABILITIES.transcriptRead,
			EDIT_CAPABILITIES.localProcess,
			EDIT_CAPABILITIES.worldLayoutEdit,
			EDIT_CAPABILITIES.reviewRead,
			EDIT_CAPABILITIES.permissionsManage,
		]);
		expect(legacy.map(({ href, label }) => [href, label])).toEqual([
			["/transcricoes?campanha=yuhara-main", "Transcrições"],
			["/edit/yuhara-main/sessoes", "Editar sessões"],
			["/edit/processamento?campanha=yuhara-main", "Processar"],
			["/edit/yuhara-main/mundo", "Editar mundo"],
			["/edit/revisao?campanha=yuhara-main", "Revisão"],
			["/edit/yuhara-main/permissions", "Permissões"],
		]);

		const secondCampaign = toolNavigationItemsForCampaign(
			"antes-que-seja-tarde",
			[
				EDIT_CAPABILITIES.transcriptRead,
				EDIT_CAPABILITIES.localProcess,
				EDIT_CAPABILITIES.worldLayoutEdit,
				EDIT_CAPABILITIES.reviewRead,
				EDIT_CAPABILITIES.permissionsManage,
			],
		);
		expect(secondCampaign.map(({ href, label }) => [href, label])).toEqual([
			[
				"/transcricoes?campanha=antes-que-seja-tarde",
				"Transcrições",
			],
			[
				"/edit/antes-que-seja-tarde/sessoes",
				"Editar sessões",
			],
			[
				"/edit/processamento?campanha=antes-que-seja-tarde",
				"Processar",
			],
			["/edit/antes-que-seja-tarde/mundo", "Editar mundo"],
			["/edit/revisao?campanha=antes-que-seja-tarde", "Revisão"],
			[
				"/edit/antes-que-seja-tarde/permissions",
				"Permissões",
			],
		]);
	});

	it("keeps the compatibility helper scoped to the historical campaign", () => {
		expect(
			visibleToolNavigationItems([
				EDIT_CAPABILITIES.transcriptRead,
				EDIT_CAPABILITIES.localProcess,
			]).map((item) => item.label),
		).toEqual(["Transcrições", "Editar sessões", "Processar"]);
		expect(visibleToolNavigationItems([])).toEqual([]);
	});

	it("detects explicit campaign references even when unauthorized", () => {
		expect(locationHasCampaignReference("/transcricoes", "?campanha=private-b")).toBe(true);
		expect(locationHasCampaignReference("/edit/private-b/mundo")).toBe(true);
		expect(locationHasCampaignReference("/campanhas/private-b/sessoes")).toBe(true);
		expect(locationHasCampaignReference("/campanhas/sessoes")).toBe(false);
	});

	it("derives campaign context from canonical paths or an explicit compatibility query", () => {
		const campaigns = [
			{
				technicalSlug: "yuhara-main",
				routeKey: "cronicas-da-mesa",
			},
			{
				technicalSlug: "antes-que-seja-tarde",
				routeKey: "antes-que-seja-tarde",
			},
		];

		expect(
			campaignTechnicalSlugFromLocation(
				campaigns,
				"/edit/antes-que-seja-tarde/permissions",
			),
		).toBe("antes-que-seja-tarde");
		expect(
			campaignTechnicalSlugFromLocation(
				campaigns,
				"/campanhas/cronicas-da-mesa/sessoes/42",
			),
		).toBe("yuhara-main");
		expect(
			campaignTechnicalSlugFromLocation(
				campaigns,
				"/transcricoes",
				"?campanha=antes-que-seja-tarde",
			),
		).toBe("antes-que-seja-tarde");
		expect(
			campaignTechnicalSlugFromLocation(
				campaigns,
				"/campanhas/sessoes",
			),
		).toBeNull();
		expect(
			campaignTechnicalSlugFromLocation(
				[campaigns[0]],
				"/edit/antes-que-seja-tarde/permissions",
			),
		).toBeNull();
		expect(
			campaignTechnicalSlugFromLocation(
				[campaigns[0]],
				"/transcricoes",
				"?campanha=antes-que-seja-tarde",
			),
		).toBeNull();
	});
});
