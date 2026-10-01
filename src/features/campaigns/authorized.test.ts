import { describe, expect, it, vi } from "vitest";
import type { EditAccessContext } from "@/features/edit/access/policy";

vi.mock("server-only", () => ({}));

import { authorizedCampaignGrantScope } from "./authorized";

const NOW = new Date("2026-10-01T00:00:00Z");

function context(
	grants: EditAccessContext["grants"],
): EditAccessContext {
	return {
		authUserId: "auth-user",
		profileId: "11111111-1111-4111-8111-111111111111",
		grants,
	};
}

function grant(
	action: string,
	scopeType: string,
	scopeId: string,
	overrides: Partial<EditAccessContext["grants"][number]> = {},
) {
	return {
		action,
		scopeType,
		scopeId,
		status: "active",
		startsAt: "2026-01-01T00:00:00Z",
		endsAt: null,
		...overrides,
	};
}

describe("authorized campaign discovery scope", () => {
	it("keeps transcript A/B grants explicit and ignores unrelated capabilities", () => {
		expect(
			authorizedCampaignGrantScope(
				context([
					grant("campaign.transcript.read", "campaign", "campaign-b"),
					grant("campaign.transcript.read", "campaign", "campaign-a"),
					grant("campaign.transcript.read", "campaign", "campaign-a"),
					grant("narrative.review.read", "campaign", "private-c"),
				]),
				"campaign.transcript.read",
				NOW,
			),
		).toEqual({
			projectWide: false,
			campaignSlugs: ["campaign-a", "campaign-b"],
		});
	});

	it("lets an exact project/tda grant cover N campaigns without enumerating them from grants", () => {
		expect(
			authorizedCampaignGrantScope(
				context([
					grant("campaign.transcript.read", "project", "tda"),
					grant("campaign.transcript.read", "campaign", "campaign-a"),
				]),
				"campaign.transcript.read",
				NOW,
			),
		).toEqual({ projectWide: true, campaignSlugs: [] });
	});

	it("does not treat another project, stale, future or revoked grants as discovery authority", () => {
		expect(
			authorizedCampaignGrantScope(
				context([
					grant("campaign.transcript.read", "project", "dnd-scribe"),
					grant("campaign.transcript.read", "campaign", "expired", {
						endsAt: "2026-09-30T23:59:59Z",
					}),
					grant("campaign.transcript.read", "campaign", "future", {
						startsAt: "2026-10-02T00:00:00Z",
					}),
					grant("campaign.transcript.read", "campaign", "revoked", {
						status: "revoked",
					}),
				]),
				"campaign.transcript.read",
				NOW,
			),
		).toEqual({ projectWide: false, campaignSlugs: [] });
	});
});
