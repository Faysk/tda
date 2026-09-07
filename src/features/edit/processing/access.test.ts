import { describe, expect, it } from "vitest";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditGrant,
} from "../access/policy";
const grant: EditGrant = {
	action: EDIT_CAPABILITIES.localProcess,
	scopeType: "campaign",
	scopeId: "yuhara-main",
	status: "active",
	startsAt: "2026-01-01",
	endsAt: null,
};
describe("local processing capability", () => {
	it.each([
		"campaign.transcript.read",
		"campaign.content.edit",
		"campaign.upload.manage",
		"project.jobs.run",
	])("does not infer permission from %s", (action) => {
		expect(
			authorizeCampaignCapability(
				{
					authUserId: "user",
					profileId: "profile",
					grants: [{ ...grant, action }],
				},
				EDIT_CAPABILITIES.localProcess,
				"yuhara-main",
			).ok,
		).toBe(false);
	});
	it("requires explicit active assignment covering the campaign", () => {
		const check = (value: EditGrant) =>
			authorizeCampaignCapability(
				{ authUserId: "user", profileId: "profile", grants: [value] },
				EDIT_CAPABILITIES.localProcess,
				"yuhara-main",
			).ok;
		expect(check(grant)).toBe(true);
		expect(check({ ...grant, scopeId: "other-campaign" })).toBe(false);
		expect(check({ ...grant, status: "revoked" })).toBe(false);
		expect(check({ ...grant, scopeType: "project", scopeId: "tda" })).toBe(
			true,
		);
	});
});
