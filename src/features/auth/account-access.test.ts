import { describe, expect, it } from "vitest";
import { EDIT_CAPABILITIES, type EditAccessContext } from "@/features/edit/access/policy";
import {
	ACCOUNT_CAPABILITY_GROUPS,
	effectiveAccountCampaignCapabilityGroups,
	effectiveAccountCapabilityGroups,
	effectiveAccountProjectCapabilityGroups,
	explicitAccountCampaignSlugsForCapability,
	hasAnyActiveAccountGrant,
} from "./account-access";

const NOW = new Date("2026-09-28T00:00:00Z");

function context(
	grants: EditAccessContext["grants"],
	profileId: string | null = "profile-1",
): EditAccessContext {
	return {
		authUserId: "auth-private",
		profileId,
		grants,
	};
}

function activeGrant(
	action: string,
	overrides: Partial<EditAccessContext["grants"][number]> = {},
): EditAccessContext["grants"][number] {
	return {
		action,
		scopeType: "campaign",
		scopeId: "yuhara-main",
		status: "active",
		startsAt: "2026-01-01T00:00:00Z",
		endsAt: null,
		...overrides,
	};
}

function visibleCapabilities(groups: ReturnType<typeof effectiveAccountCapabilityGroups>) {
	return groups.flatMap((group) => group.items.map((item) => item.capability));
}

describe("account effective capability projection", () => {
	it("shows only capabilities authorized by the canonical campaign resolver", () => {
		const groups = effectiveAccountCapabilityGroups(
			context([
				activeGrant(EDIT_CAPABILITIES.contentEdit),
				activeGrant(EDIT_CAPABILITIES.transcriptRead),
				activeGrant(EDIT_CAPABILITIES.permissionsManage),
				activeGrant(EDIT_CAPABILITIES.reviewManage, { status: "revoked" }),
				activeGrant(EDIT_CAPABILITIES.localProcess, {
					endsAt: "2026-09-27T23:59:59Z",
				}),
				activeGrant(EDIT_CAPABILITIES.worldLayoutEdit, {
					scopeId: "other-campaign",
				}),
			]),
			"yuhara-main",
			NOW,
		);

		expect(visibleCapabilities(groups)).toEqual([
			EDIT_CAPABILITIES.contentEdit,
			EDIT_CAPABILITIES.transcriptRead,
			EDIT_CAPABILITIES.permissionsManage,
		]);
	});

	it("accepts project-scoped grants only for the exact capability", () => {
		const groups = effectiveAccountCapabilityGroups(
			context([
				activeGrant(EDIT_CAPABILITIES.sessionPublish, {
					scopeType: "project",
					scopeId: "tda",
				}),
			]),
			"yuhara-main",
			NOW,
		);

		expect(visibleCapabilities(groups)).toEqual([
			EDIT_CAPABILITIES.sessionPublish,
		]);
	});

	it("returns no visual permissions when the profile is unresolved", () => {
		const groups = effectiveAccountCapabilityGroups(
			context([activeGrant(EDIT_CAPABILITIES.contentEdit)], null),
			"yuhara-main",
			NOW,
		);

		expect(groups).toEqual([]);
	});

	it("keeps every displayed capability mapped to a human label", () => {
		for (const group of ACCOUNT_CAPABILITY_GROUPS) {
			expect(group.title.trim()).not.toBe("");
			for (const item of group.items) {
				expect(item.label.trim()).not.toBe("");
				expect(Object.values(EDIT_CAPABILITIES)).toContain(item.capability);
			}
		}
	});
});


describe("account scoped capability projection", () => {
	it("keeps campaign A and B independent instead of inheriting a historical singleton", () => {
		const access = context([
			activeGrant(EDIT_CAPABILITIES.transcriptRead, { scopeId: "campaign-a" }),
			activeGrant(EDIT_CAPABILITIES.worldLayoutEdit, { scopeId: "campaign-b" }),
		]);

		expect(
			visibleCapabilities(
				effectiveAccountCampaignCapabilityGroups(access, "campaign-a", NOW),
			),
		).toEqual([EDIT_CAPABILITIES.transcriptRead]);
		expect(
			visibleCapabilities(
				effectiveAccountCampaignCapabilityGroups(access, "campaign-b", NOW),
			),
		).toEqual([EDIT_CAPABILITIES.worldLayoutEdit]);
		expect(
			effectiveAccountCampaignCapabilityGroups(access, "yuhara-main", NOW),
		).toEqual([]);
	});

	it("separates project-wide authority and does not duplicate it in campaign-specific groups", () => {
		const access = context([
			activeGrant(EDIT_CAPABILITIES.transcriptRead, {
				scopeType: "project",
				scopeId: "tda",
			}),
			activeGrant(EDIT_CAPABILITIES.transcriptRead, { scopeId: "campaign-a" }),
			activeGrant(EDIT_CAPABILITIES.contentEdit, { scopeId: "campaign-a" }),
		]);

		expect(
			visibleCapabilities(effectiveAccountProjectCapabilityGroups(access, NOW)),
		).toEqual([EDIT_CAPABILITIES.transcriptRead]);
		expect(
			visibleCapabilities(
				effectiveAccountCampaignCapabilityGroups(access, "campaign-a", NOW),
			),
		).toEqual([EDIT_CAPABILITIES.contentEdit]);
		expect(
			explicitAccountCampaignSlugsForCapability(
				access,
				EDIT_CAPABILITIES.transcriptRead,
				NOW,
			),
		).toEqual([]);
	});

	it("reflects revocation and expiry without turning stale grants into effective access", () => {
		const access = context([
			activeGrant(EDIT_CAPABILITIES.contentEdit, {
				scopeId: "campaign-a",
				status: "revoked",
			}),
			activeGrant(EDIT_CAPABILITIES.transcriptRead, {
				scopeId: "campaign-b",
				endsAt: "2026-09-27T23:59:59Z",
			}),
		]);

		expect(hasAnyActiveAccountGrant(access, NOW)).toBe(false);
		expect(
			effectiveAccountCampaignCapabilityGroups(access, "campaign-a", NOW),
		).toEqual([]);
		expect(
			effectiveAccountCampaignCapabilityGroups(access, "campaign-b", NOW),
		).toEqual([]);
	});

	it("recognizes an active grant outside the legacy campaign when deriving linked state", () => {
		const access = context([
			activeGrant(EDIT_CAPABILITIES.contentEdit, { scopeId: "campaign-b" }),
		]);
		expect(hasAnyActiveAccountGrant(access, NOW)).toBe(true);
	});
});
