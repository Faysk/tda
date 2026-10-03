import { describe, expect, it } from "vitest";
import { EDIT_CAPABILITIES, type EditAccessContext } from "@/features/edit/access/policy";
import {
	ACCOUNT_CAPABILITY_GROUPS,
	campaignSpecificAccountCapabilityGroups,
	effectiveAccountCapabilityGroups,
	hasAnyEffectiveAccountCapability,
	projectAccountCapabilityGroups,
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
	it("shows only capabilities authorized by the requested campaign resolver", () => {
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

	it("separates project authority from A-only, B-only and A+B campaign grants", () => {
		const access = context([
			activeGrant(EDIT_CAPABILITIES.contentEdit, { scopeId: "campaign-a" }),
			activeGrant(EDIT_CAPABILITIES.transcriptRead, { scopeId: "campaign-b" }),
			activeGrant(EDIT_CAPABILITIES.sessionPublish, {
				scopeType: "project",
				scopeId: "tda",
			}),
		]);

		expect(
			visibleCapabilities(
				campaignSpecificAccountCapabilityGroups(access, "campaign-a", NOW),
			),
		).toEqual([EDIT_CAPABILITIES.contentEdit]);
		expect(
			visibleCapabilities(
				campaignSpecificAccountCapabilityGroups(access, "campaign-b", NOW),
			),
		).toEqual([EDIT_CAPABILITIES.transcriptRead]);
		expect(visibleCapabilities(projectAccountCapabilityGroups(access, NOW))).toEqual([
			EDIT_CAPABILITIES.sessionPublish,
		]);
		expect(
			visibleCapabilities(effectiveAccountCapabilityGroups(access, "campaign-a", NOW)),
		).toEqual([
			EDIT_CAPABILITIES.contentEdit,
			EDIT_CAPABILITIES.sessionPublish,
		]);
		expect(
			visibleCapabilities(effectiveAccountCapabilityGroups(access, "campaign-b", NOW)),
		).toEqual([
			EDIT_CAPABILITIES.sessionPublish,
			EDIT_CAPABILITIES.transcriptRead,
		]);
	});

	it("detects effective access without pinning account state to the legacy campaign", () => {
		expect(
			hasAnyEffectiveAccountCapability(
				context([
					activeGrant(EDIT_CAPABILITIES.worldLayoutEdit, {
						scopeId: "campaign-b",
					}),
				]),
				NOW,
			),
		).toBe(true);
		expect(
			hasAnyEffectiveAccountCapability(
				context([
					activeGrant(EDIT_CAPABILITIES.worldLayoutEdit, {
						scopeId: "campaign-b",
						status: "revoked",
					}),
				]),
				NOW,
			),
		).toBe(false);
	});

	it("returns no visual permissions when the profile is unresolved", () => {
		const groups = effectiveAccountCapabilityGroups(
			context([activeGrant(EDIT_CAPABILITIES.contentEdit)], null),
			"yuhara-main",
			NOW,
		);

		expect(groups).toEqual([]);
		expect(projectAccountCapabilityGroups(context([], null), NOW)).toEqual([]);
		expect(
			campaignSpecificAccountCapabilityGroups(
				context([activeGrant(EDIT_CAPABILITIES.contentEdit)], null),
				"yuhara-main",
				NOW,
			),
		).toEqual([]);
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
