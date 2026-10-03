import { describe, expect, it } from "vitest";
import type { ManageableCampaign } from "@/features/campaigns/model";
import { reconcileCreatedLembraCampaign } from "./campaign-composer";

const current = [
	{
		id: "11111111-1111-4111-8111-111111111111",
		name: "Mesa",
		lifecycle: "active" as const,
	},
];

function campaign(
	overrides: Partial<ManageableCampaign> = {},
): ManageableCampaign {
	return {
		id: "22222222-2222-4222-8222-222222222222",
		technicalSlug: "nova-campanha",
		routeKey: "nova-campanha",
		name: "Nova campanha",
		description: null,
		lifecycle: "active",
		visibility: "public",
		archivedAt: null,
		updatedAt: "2026-10-03T04:00:00.000Z",
		coverImage: null,
		hasCoverBinding: false,
		...overrides,
	};
}

describe("Lembra contextual campaign creation", () => {
	it("adds and selects an eligible public campaign without duplicating it", () => {
		const created = campaign();
		const first = reconcileCreatedLembraCampaign(current, null, created);
		const second = reconcileCreatedLembraCampaign(
			first.campaigns,
			first.campaignId,
			created,
		);

		expect(first.campaignId).toBe(created.id);
		expect(first.message).toBe("Campanha criada e selecionada.");
		expect(second.campaigns).toHaveLength(2);
		expect(second.campaignId).toBe(created.id);
	});

	it("keeps the previous selection when the new campaign is private", () => {
		const result = reconcileCreatedLembraCampaign(
			current,
			current[0].id,
			campaign({ visibility: "private" }),
		);

		expect(result.campaigns).toBe(current);
		expect(result.campaignId).toBe(current[0].id);
		expect(result.message).toBe(
			"A campanha foi criada como privada e não aparece como classificação do Lembra.",
		);
	});

	it("does not make an archived campaign a new destination", () => {
		const result = reconcileCreatedLembraCampaign(
			current,
			null,
			campaign({ lifecycle: "archived" }),
		);

		expect(result.campaigns).toBe(current);
		expect(result.campaignId).toBeNull();
		expect(result.message).toContain("não está ativa");
	});
});
