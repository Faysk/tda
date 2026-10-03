import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "@/features/edit/access/policy";

const mocks = vi.hoisted(() => ({
	readAuthorizedCampaigns: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/campaigns/authorized", () => ({
	readAuthorizedCampaigns: mocks.readAuthorizedCampaigns,
}));

import { readAccountCampaignAccess } from "./account-campaigns";

function grant(
	action: string,
	scopeId: string,
	overrides: Partial<EditAccessContext["grants"][number]> = {},
): EditAccessContext["grants"][number] {
	return {
		action,
		scopeType: "campaign",
		scopeId,
		status: "active",
		startsAt: "2026-01-01T00:00:00Z",
		endsAt: null,
		...overrides,
	};
}

function context(
	grants: EditAccessContext["grants"],
): EditAccessContext {
	return {
		authUserId: "auth-user",
		profileId: "profile-1",
		grants,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.readAuthorizedCampaigns.mockImplementation(
		async (_context: EditAccessContext, capability: string) => ({
			ok: true,
			campaigns:
				capability === EDIT_CAPABILITIES.transcriptRead
					? [
							{
								technicalSlug: "campaign-a",
								name: "Campanha A",
								lifecycle: "active",
							},
							{
								technicalSlug: "private-unrelated",
								name: "Privada não solicitada",
								lifecycle: "active",
							},
						]
					: capability === EDIT_CAPABILITIES.worldLayoutEdit
						? [
								{
									technicalSlug: "campaign-b",
									name: "Campanha B",
									lifecycle: "active",
								},
							]
						: [],
		}),
	);
});

describe("account campaign access discovery", () => {
	it("resolves A-only and B-only grants into explicit human campaign contexts", async () => {
		const result = await readAccountCampaignAccess(
			context([
				grant(EDIT_CAPABILITIES.transcriptRead, "campaign-a"),
				grant(EDIT_CAPABILITIES.worldLayoutEdit, "campaign-b"),
			]),
		);

		expect(result.status).toBe("ready");
		if (result.status !== "ready") return;
		expect(
			result.campaigns.map((campaign) => ({
				slug: campaign.technicalSlug,
				name: campaign.name,
				capabilities: campaign.capabilityGroups.flatMap((group) =>
					group.items.map((item) => item.capability),
				),
			})),
		).toEqual([
			{
				slug: "campaign-a",
				name: "Campanha A",
				capabilities: [EDIT_CAPABILITIES.transcriptRead],
			},
			{
				slug: "campaign-b",
				name: "Campanha B",
				capabilities: [EDIT_CAPABILITIES.worldLayoutEdit],
			},
		]);
	});

	it("does not enumerate an unrelated private campaign returned by a broader dependency projection", async () => {
		const result = await readAccountCampaignAccess(
			context([grant(EDIT_CAPABILITIES.transcriptRead, "campaign-a")]),
		);

		expect(result).toMatchObject({
			status: "ready",
			campaigns: [{ technicalSlug: "campaign-a", name: "Campanha A" }],
		});
		expect(JSON.stringify(result)).not.toContain("private-unrelated");
	});

	it("keeps project-wide authority out of campaign enumeration", async () => {
		const result = await readAccountCampaignAccess(
			context([
				grant(EDIT_CAPABILITIES.transcriptRead, "tda", {
					scopeType: "project",
				}),
			]),
		);

		expect(result).toEqual({ status: "ready", campaigns: [] });
		expect(mocks.readAuthorizedCampaigns).not.toHaveBeenCalled();
	});

	it("reports discovery failure instead of presenting it as no permission", async () => {
		mocks.readAuthorizedCampaigns.mockResolvedValueOnce({
			ok: false,
			reason: "dependency_unavailable",
		});
		await expect(
			readAccountCampaignAccess(
				context([grant(EDIT_CAPABILITIES.transcriptRead, "campaign-a")]),
			),
		).resolves.toEqual({ status: "unavailable", campaigns: [] });
	});
});
