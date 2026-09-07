import { describe, expect, it } from "vitest";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "./policy";

const now = new Date("2026-09-07T04:00:00.000Z");

function context(
	overrides: Partial<EditAccessContext> = {},
): EditAccessContext {
	return {
		authUserId: "auth-user",
		profileId: "profile-1",
		grants: [],
		...overrides,
	};
}

function grant(overrides: Record<string, string | null> = {}) {
	return {
		action: EDIT_CAPABILITIES.transcriptRead,
		scopeType: "campaign",
		scopeId: "yuhara-main",
		status: "active",
		startsAt: "2026-01-01T00:00:00.000Z",
		endsAt: null,
		...overrides,
	};
}

describe("authorizeCampaignCapability", () => {
	it("rejects an authenticated user without a resolved profile", () => {
		expect(
			authorizeCampaignCapability(
				context({ profileId: null }),
				EDIT_CAPABILITIES.transcriptRead,
				"yuhara-main",
				now,
			),
		).toEqual({ ok: false, reason: "profile_unresolved" });
	});

	it("allows an active campaign-scoped capability", () => {
		expect(
			authorizeCampaignCapability(
				context({ grants: [grant()] }),
				EDIT_CAPABILITIES.transcriptRead,
				"yuhara-main",
				now,
			),
		).toEqual({ ok: true, profileId: "profile-1" });
	});

	it("allows a project scope capability with scope_id tda to cover a campaign", () => {
		expect(
			authorizeCampaignCapability(
				context({
					grants: [grant({ scopeType: "project", scopeId: "tda" })],
				}),
				EDIT_CAPABILITIES.transcriptRead,
				"yuhara-main",
				now,
			),
		).toEqual({ ok: true, profileId: "profile-1" });
	});

	it("does not accept the legacy composite project/tda string as scope_id", () => {
		expect(
			authorizeCampaignCapability(
				context({
					grants: [grant({ scopeType: "project", scopeId: "project/tda" })],
				}),
				EDIT_CAPABILITIES.transcriptRead,
				"yuhara-main",
				now,
			),
		).toEqual({ ok: false, reason: "forbidden" });
	});

	it("rejects a capability from another campaign", () => {
		expect(
			authorizeCampaignCapability(
				context({ grants: [grant({ scopeId: "other-campaign" })] }),
				EDIT_CAPABILITIES.transcriptRead,
				"yuhara-main",
				now,
			),
		).toEqual({ ok: false, reason: "forbidden" });
	});

	it("rejects inactive, future and expired grants", () => {
		const invalidGrants = [
			grant({ status: "revoked" }),
			grant({ startsAt: "2026-09-08T00:00:00.000Z" }),
			grant({ endsAt: "2026-09-07T03:59:59.000Z" }),
		];

		expect(
			authorizeCampaignCapability(
				context({ grants: invalidGrants }),
				EDIT_CAPABILITIES.transcriptRead,
				"yuhara-main",
				now,
			),
		).toEqual({ ok: false, reason: "forbidden" });
	});

	it("does not treat transcript read as content edit", () => {
		expect(
			authorizeCampaignCapability(
				context({ grants: [grant()] }),
				EDIT_CAPABILITIES.contentEdit,
				"yuhara-main",
				now,
			),
		).toEqual({ ok: false, reason: "forbidden" });
	});
});
