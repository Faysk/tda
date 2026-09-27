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


describe("activity bark management capability", () => {
	const barkGrant: EditGrant = {
		...grant,
		action: EDIT_CAPABILITIES.activityBarksManage,
	};

	it("requires the dedicated exact capability", () => {
		expect(
			authorizeCampaignCapability(
				{ authUserId: "owner", profileId: "profile", grants: [barkGrant] },
				EDIT_CAPABILITIES.activityBarksManage,
				"yuhara-main",
			).ok,
		).toBe(true);

		expect(
			authorizeCampaignCapability(
				{ authUserId: "operator", profileId: "profile", grants: [grant] },
				EDIT_CAPABILITIES.activityBarksManage,
				"yuhara-main",
			).ok,
		).toBe(false);
	});

	it("keeps project/tda inheritance and denies wrong campaign scope", () => {
		expect(
			authorizeCampaignCapability(
				{
					authUserId: "owner",
					profileId: "profile",
					grants: [{ ...barkGrant, scopeType: "project", scopeId: "tda" }],
				},
				EDIT_CAPABILITIES.activityBarksManage,
				"yuhara-main",
			).ok,
		).toBe(true);
		expect(
			authorizeCampaignCapability(
				{
					authUserId: "owner",
					profileId: "profile",
					grants: [{ ...barkGrant, scopeId: "other-campaign" }],
				},
				EDIT_CAPABILITIES.activityBarksManage,
				"yuhara-main",
			).ok,
		).toBe(false);
	});
});
