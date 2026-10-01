import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { EditAccessContext } from "@/features/edit/access/policy";
import {
	campaignGrantScopeForCapabilities,
} from "./authorized";

const NOW = new Date("2026-10-01T00:00:00Z");

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

function context(grants: EditAccessContext["grants"]): EditAccessContext {
	return {
		authUserId: "auth-user",
		profileId: "11111111-1111-4111-8111-111111111111",
		grants,
	};
}

describe("authorized campaign scope", () => {
	it("collects campaign scopes for any requested capability", () => {
		expect(
			campaignGrantScopeForCapabilities(
				context([
					grant("campaign.transcript.read", "campaign", "campaign-a"),
					grant("campaign.content.edit", "campaign", "campaign-b"),
					grant("campaign.local.process", "campaign", "unrelated"),
				]),
				["campaign.transcript.read", "campaign.content.edit"],
				NOW,
			),
		).toEqual({
			projectWide: false,
			campaignSlugs: ["campaign-a", "campaign-b"],
		});
	});

	it("lets an applicable project grant cover active campaigns without enumerating them", () => {
		expect(
			campaignGrantScopeForCapabilities(
				context([
					grant("campaign.transcript.read", "project", "tda"),
					grant("campaign.content.edit", "campaign", "campaign-b"),
				]),
				["campaign.transcript.read"],
				NOW,
			),
		).toEqual({ projectWide: true, campaignSlugs: [] });
	});

	it("does not treat session/resource scopes or unrelated project grants as campaign discovery", () => {
		expect(
			campaignGrantScopeForCapabilities(
				context([
					grant("campaign.transcript.read", "session", "session-a"),
					grant("campaign.transcript.read", "resource", "resource-a"),
					grant("campaign.local.process", "project", "tda"),
				]),
				["campaign.transcript.read"],
				NOW,
			),
		).toEqual({ projectWide: false, campaignSlugs: [] });
	});

	it("ignores inactive, future and expired grants", () => {
		expect(
			campaignGrantScopeForCapabilities(
				context([
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
				["campaign.transcript.read"],
				NOW,
			),
		).toEqual({ projectWide: false, campaignSlugs: [] });
	});
});
