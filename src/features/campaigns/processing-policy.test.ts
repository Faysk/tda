import { describe, expect, it } from "vitest";
import type { EditAccessContext } from "@/features/edit/access/policy";
import { processingCampaignGrantScope } from "./processing-policy";

const NOW = new Date("2026-09-30T12:00:00Z");

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

describe("processing campaign grant scope", () => {
	it("keeps local-processing campaign grants explicit and deduplicated", () => {
		expect(
			processingCampaignGrantScope(
				context([
					grant("campaign.local.process", "campaign", "campaign-b"),
					grant("campaign.local.process", "campaign", "campaign-a"),
					grant("campaign.local.process", "campaign", "campaign-a"),
					grant("campaign.transcript.read", "campaign", "private-c"),
				]),
				NOW,
			),
		).toEqual({
			projectWide: false,
			campaignSlugs: ["campaign-a", "campaign-b"],
		});
	});

	it("treats an active project grant as coverage for active campaigns", () => {
		expect(
			processingCampaignGrantScope(
				context([
					grant("campaign.local.process", "project", "tda"),
					grant("campaign.local.process", "campaign", "campaign-a"),
				]),
				NOW,
			),
		).toEqual({ projectWide: true, campaignSlugs: [] });
	});

	it("ignores expired, future, inactive and unrelated grants", () => {
		expect(
			processingCampaignGrantScope(
				context([
					grant("campaign.local.process", "campaign", "expired", {
						endsAt: "2026-09-30T11:59:59Z",
					}),
					grant("campaign.local.process", "campaign", "future", {
						startsAt: "2026-10-01T00:00:00Z",
					}),
					grant("campaign.local.process", "campaign", "inactive", {
						status: "revoked",
					}),
					grant("campaign.transcript.read", "campaign", "other"),
				]),
				NOW,
			),
		).toEqual({ projectWide: false, campaignSlugs: [] });
	});
});
