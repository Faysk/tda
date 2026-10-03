import { describe, expect, it } from "vitest";
import {
	canDiscoverLembraCampaign,
	isLembraCampaignRegistryUnavailable,
} from "./campaign-classification";
import type { EditAccessContext } from "@/features/edit/access/policy";

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


describe("Lembra private campaign discovery", () => {
	const base: EditAccessContext = {
		authUserId: "viewer",
		profileId: "profile",
		grants: [],
	};

	it("discovers a private campaign only through an active matching or project grant", () => {
		const campaignGrant: EditAccessContext = {
			...base,
			grants: [{
				action: "campaign.content.edit",
				scopeType: "campaign",
				scopeId: "passos-retomados",
				status: "active",
				startsAt: "2026-01-01T00:00:00Z",
				endsAt: null,
			}],
		};
		expect(canDiscoverLembraCampaign(campaignGrant, "passos-retomados")).toBe(true);
		expect(canDiscoverLembraCampaign(campaignGrant, "destino-sem-fim")).toBe(false);

		const projectGrant: EditAccessContext = {
			...base,
			grants: [{
				action: "project.campaigns.manage",
				scopeType: "project",
				scopeId: "tda",
				status: "active",
				startsAt: "2026-01-01T00:00:00Z",
				endsAt: null,
			}],
		};
		expect(canDiscoverLembraCampaign(projectGrant, "passos-retomados")).toBe(true);
	});

	it("fails closed for unlinked, revoked and unrelated grants", () => {
		expect(
			canDiscoverLembraCampaign({ ...base, profileId: null }, "passos-retomados"),
		).toBe(false);
		expect(
			canDiscoverLembraCampaign({
				...base,
				grants: [{
					action: "campaign.content.edit",
					scopeType: "campaign",
					scopeId: "passos-retomados",
					status: "revoked",
					startsAt: "2026-01-01T00:00:00Z",
					endsAt: null,
				}],
			}, "passos-retomados"),
		).toBe(false);
	});
});
