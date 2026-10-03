import { describe, expect, it } from "vitest";
import { reconcileCreatedLembraCampaign } from "./campaign-composer";

const current = [
	{
		id: "11111111-1111-4111-8111-111111111111",
		name: "Mesa",
		lifecycle: "active" as const,
	},
];

const created = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "Nova campanha",
	lifecycle: "active" as const,
};

describe("Lembra contextual campaign creation", () => {
	it("selects a newly created campaign only after the refreshed projection includes it", () => {
		const first = reconcileCreatedLembraCampaign(
			[...current, created],
			null,
			created.id,
		);
		const second = reconcileCreatedLembraCampaign(
			first.campaigns,
			first.campaignId,
			created.id,
		);

		expect(first.campaignId).toBe(created.id);
		expect(first.message).toBe("Campanha criada e selecionada.");
		expect(second.campaigns).toHaveLength(2);
		expect(second.campaignId).toBe(created.id);
	});

	it("supports a discoverable private campaign because visibility is enforced server-side", () => {
		const privateProjected = {
			...created,
			name: "Campanha privada autorizada",
		};
		const result = reconcileCreatedLembraCampaign(
			[...current, privateProjected],
			current[0].id,
			privateProjected.id,
		);

		expect(result.campaignId).toBe(privateProjected.id);
		expect(result.message).toBe("Campanha criada e selecionada.");
	});

	it("keeps the previous selection when the created campaign is absent from the authorized projection", () => {
		const result = reconcileCreatedLembraCampaign(
			current,
			current[0].id,
			created.id,
		);

		expect(result.campaigns).toEqual(current);
		expect(result.campaignId).toBe(current[0].id);
		expect(result.message).toContain("não está disponível");
	});

	it("does not make an archived campaign a new destination", () => {
		const archived = { ...created, lifecycle: "archived" as const };
		const result = reconcileCreatedLembraCampaign(
			[...current, archived],
			null,
			archived.id,
		);

		expect(result.campaignId).toBeNull();
		expect(result.message).toContain("não está ativa");
	});
});
