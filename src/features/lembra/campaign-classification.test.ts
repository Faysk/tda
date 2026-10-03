import { describe, expect, it } from "vitest";
import {
	isLembraCampaignRegistryUnavailable,
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


describe("Lembra privacy-safe campaign mutation", () => {
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
	const archivedPrivate = {
		id: "33333333-3333-4333-8333-333333333333",
		name: "Segredo arquivado",
		lifecycle: "archived" as const,
	};

	it("preserves a hidden current classification without exposing it", () => {
		expect(
			resolveLembraCampaignMutation(
				privateCampaign.id,
				[publicCampaign],
				{ kind: "preserve" },
			),
		).toEqual({
			ok: true,
			campaignId: privateCampaign.id,
			campaign: null,
		});
	});

	it("denies clear and direct set when a private campaign is not discoverable", () => {
		expect(
			resolveLembraCampaignMutation(
				privateCampaign.id,
				[publicCampaign],
				{ kind: "clear" },
			),
		).toEqual({ ok: false, reason: "forbidden" });
		expect(
			resolveLembraCampaignMutation(
				null,
				[publicCampaign],
				{ kind: "set", campaignId: privateCampaign.id },
			),
		).toEqual({ ok: false, reason: "forbidden" });
	});

	it("allows an authorized viewer to set or clear a discoverable private campaign", () => {
		const visible = [publicCampaign, privateCampaign];
		expect(
			resolveLembraCampaignMutation(
				null,
				visible,
				{ kind: "set", campaignId: privateCampaign.id },
			),
		).toEqual({
			ok: true,
			campaignId: privateCampaign.id,
			campaign: privateCampaign,
		});
		expect(
			resolveLembraCampaignMutation(
				privateCampaign.id,
				visible,
				{ kind: "clear" },
			),
		).toEqual({ ok: true, campaignId: null, campaign: null });
	});

	it("shows an authorized archived classification historically but rejects it as a new target", () => {
		const visible = [publicCampaign, archivedPrivate];
		expect(
			resolveLembraCampaignMutation(
				archivedPrivate.id,
				visible,
				{ kind: "preserve" },
			),
		).toEqual({
			ok: true,
			campaignId: archivedPrivate.id,
			campaign: archivedPrivate,
		});
		expect(
			resolveLembraCampaignMutation(
				null,
				visible,
				{ kind: "set", campaignId: archivedPrivate.id },
			),
		).toEqual({ ok: false, reason: "forbidden" });
	});
});
