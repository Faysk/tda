import { describe, expect, it } from "vitest";
import {
	isLembraCampaignRegistryUnavailable,
	mergeLembraCampaignClassifications,
	projectLembraCampaignClassification,
	resolveLembraCampaignMutation,
} from "./campaign-classification";

describe("Lembra campaign registry compatibility", () => {
	it("degrades only when first-class campaign columns are not yet exposed", () => {
		expect(
			isLembraCampaignRegistryUnavailable({
				code: "PGRST204",
				message:
					"Could not find the 'lifecycle' column of 'campaigns' in the schema cache",
			}),
		).toBe(true);
		expect(
			isLembraCampaignRegistryUnavailable({
				code: "PGRST204",
				message:
					"Could not find the 'visibility' column of 'campaigns' in the schema cache",
			}),
		).toBe(true);
		expect(
			isLembraCampaignRegistryUnavailable({
				code: "42703",
				message: "column campaigns.lifecycle does not exist",
			}),
		).toBe(true);
	});

	it("does not hide unrelated database or schema failures", () => {
		expect(
			isLembraCampaignRegistryUnavailable({
				code: "42501",
				message: "permission denied for table campaigns",
			}),
		).toBe(false);
		expect(
			isLembraCampaignRegistryUnavailable({
				code: "PGRST204",
				message:
					"Could not find the 'campaign_id' column of 'lembra_references' in the schema cache",
			}),
		).toBe(false);
	});
});


describe("Lembra privacy-safe campaign classification", () => {
	const publicCampaign = {
		id: "11111111-1111-4111-8111-111111111111",
		name: "Destino Sem Fim",
		lifecycle: "active" as const,
	};
	const privateCampaign = {
		id: "22222222-2222-4222-8222-222222222222",
		name: "Passos Retomados",
		lifecycle: "active" as const,
	};
	const archivedPrivateCampaign = {
		id: "33333333-3333-4333-8333-333333333333",
		name: "Privada arquivada",
		lifecycle: "archived" as const,
	};

	it("merges public and viewer-discoverable projections without forwarding operational metadata", () => {
		const result = mergeLembraCampaignClassifications(
			[publicCampaign],
			[
				{
					...privateCampaign,
					visibility: "private",
					technicalSlug: "private-secret",
					routeKey: "private-route",
				},
			],
		);

		expect(result).toEqual([publicCampaign, privateCampaign]);
		expect(result).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ technicalSlug: expect.anything() }),
			]),
		);
		expect(result).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ routeKey: expect.anything() }),
			]),
		);
	});

	it("keeps a private campaign completely absent when the viewer cannot discover it", () => {
		expect(
			mergeLembraCampaignClassifications([publicCampaign], []),
		).toEqual([publicCampaign]);
	});

	it("marks an existing undiscoverable binding as restricted without exposing campaign metadata", () => {
		expect(
			projectLembraCampaignClassification(privateCampaign.id, null),
		).toEqual({ campaign: null, campaignRestricted: true });
	});

	it("preserves a hidden binding only for explicit metadata-only preserve intent", () => {
		expect(
			resolveLembraCampaignMutation({
				currentCampaignId: privateCampaign.id,
				currentCampaign: null,
				intent: { kind: "preserve" },
				discoverableCampaigns: [publicCampaign],
			}),
		).toEqual({
			ok: true,
			campaignId: privateCampaign.id,
			campaign: null,
			campaignRestricted: true,
		});

		for (const intent of [
			{ kind: "clear" as const },
			{ kind: "set" as const, campaignId: publicCampaign.id },
		]) {
			expect(
				resolveLembraCampaignMutation({
					currentCampaignId: privateCampaign.id,
					currentCampaign: null,
					intent,
					discoverableCampaigns: [publicCampaign],
				}),
			).toEqual({ ok: false });
		}
	});

	it("allows active discoverable targets but rejects forged and archived new targets", () => {
		expect(
			resolveLembraCampaignMutation({
				currentCampaignId: null,
				currentCampaign: null,
				intent: { kind: "set", campaignId: privateCampaign.id },
				discoverableCampaigns: [publicCampaign, privateCampaign],
			}),
		).toEqual({
			ok: true,
			campaignId: privateCampaign.id,
			campaign: privateCampaign,
			campaignRestricted: false,
		});

		expect(
			resolveLembraCampaignMutation({
				currentCampaignId: null,
				currentCampaign: null,
				intent: {
					kind: "set",
					campaignId: "99999999-9999-4999-8999-999999999999",
				},
				discoverableCampaigns: [publicCampaign, privateCampaign],
			}),
		).toEqual({ ok: false });

		expect(
			resolveLembraCampaignMutation({
				currentCampaignId: null,
				currentCampaign: null,
				intent: { kind: "set", campaignId: archivedPrivateCampaign.id },
				discoverableCampaigns: [archivedPrivateCampaign],
			}),
		).toEqual({ ok: false });
	});

	it("preserves a visible archived historical binding when no classification change is requested", () => {
		expect(
			resolveLembraCampaignMutation({
				currentCampaignId: archivedPrivateCampaign.id,
				currentCampaign: archivedPrivateCampaign,
				intent: { kind: "preserve" },
				discoverableCampaigns: [archivedPrivateCampaign],
			}),
		).toEqual({
			ok: true,
			campaignId: archivedPrivateCampaign.id,
			campaign: archivedPrivateCampaign,
			campaignRestricted: false,
		});
	});
});
