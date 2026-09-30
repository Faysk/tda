import { describe, expect, it } from "vitest";
import type { EditAccessContext } from "@/features/edit/access/policy";
import { canManageCampaignRegistry } from "./policy";

const now = new Date("2026-09-30T18:00:00Z");
function context(overrides: Partial<EditAccessContext> = {}): EditAccessContext {
	return {
		authUserId: "auth-a",
		profileId: "profile-a",
		grants: [],
		...overrides,
	};
}

describe("campaign registry policy", () => {
	it("requires the exact active project/tda capability", () => {
		expect(
			canManageCampaignRegistry(
				context({
					grants: [
						{
							action: "project.campaigns.manage",
							scopeType: "project",
							scopeId: "tda",
							status: "active",
							startsAt: "2026-09-01T00:00:00Z",
							endsAt: null,
						},
					],
				}),
				now,
			),
		).toBe(true);
	});

	it("does not promote campaign grants, wrong actions, expired grants or unlinked profiles", () => {
		for (const grant of [
			{
				action: "project.campaigns.manage",
				scopeType: "campaign",
				scopeId: "yuhara-main",
				status: "active",
				startsAt: "2026-09-01T00:00:00Z",
				endsAt: null,
			},
			{
				action: "campaign.permissions.manage",
				scopeType: "project",
				scopeId: "tda",
				status: "active",
				startsAt: "2026-09-01T00:00:00Z",
				endsAt: null,
			},
			{
				action: "project.campaigns.manage",
				scopeType: "project",
				scopeId: "tda",
				status: "active",
				startsAt: "2026-09-01T00:00:00Z",
				endsAt: "2026-09-29T00:00:00Z",
			},
		]) {
			expect(canManageCampaignRegistry(context({ grants: [grant] }), now)).toBe(
				false,
			);
		}
		expect(canManageCampaignRegistry(context({ profileId: null }), now)).toBe(
			false,
		);
	});
});
