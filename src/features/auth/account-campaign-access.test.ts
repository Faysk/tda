import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "@/features/edit/access/policy";

const mocks = vi.hoisted(() => ({
	readAuthorizedCampaignAccess: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/campaigns/authorized", () => ({
	readAuthorizedCampaignAccess: mocks.readAuthorizedCampaignAccess,
}));

import { readAccountCampaignAccess } from "./account-campaign-access";

const A = {
	technicalSlug: "campaign-a",
	name: "Campanha A",
	lifecycle: "active" as const,
};
const B = {
	technicalSlug: "campaign-b",
	name: "Campanha B com nome bem comprido",
	lifecycle: "active" as const,
};

function grant(
	action: string,
	scopeType: "campaign" | "project",
	scopeId: string,
): EditAccessContext["grants"][number] {
	return {
		action,
		scopeType,
		scopeId,
		status: "active",
		startsAt: "2026-01-01T00:00:00Z",
		endsAt: null,
	};
}

function context(grants: EditAccessContext["grants"]): EditAccessContext {
	return {
		authUserId: "auth-synthetic",
		profileId: "profile-synthetic",
		grants,
	};
}

function discovered(
	campaign: typeof A | typeof B,
	capabilities: readonly (typeof EDIT_CAPABILITIES)[keyof typeof EDIT_CAPABILITIES][],
) {
	return { ...campaign, capabilities };
}

beforeEach(() => {
	mocks.readAuthorizedCampaignAccess.mockReset();
	mocks.readAuthorizedCampaignAccess.mockResolvedValue({
		ok: true,
		campaigns: [],
	});
});

describe("account campaign access projection", () => {
	it("keeps A-only and B-only discovery explicit without choosing across N campaigns", async () => {
		mocks.readAuthorizedCampaignAccess.mockResolvedValue({
			ok: true,
			campaigns: [
				discovered(A, [EDIT_CAPABILITIES.contentEdit]),
				discovered(B, [EDIT_CAPABILITIES.transcriptRead]),
			],
		});
		const result = await readAccountCampaignAccess(
			context([
				grant(EDIT_CAPABILITIES.contentEdit, "campaign", A.technicalSlug),
				grant(EDIT_CAPABILITIES.transcriptRead, "campaign", B.technicalSlug),
			]),
			null,
		);
		expect(result.state).toBe("ready");
		if (result.state !== "ready") return;
		expect(result.campaigns.map((campaign) => campaign.technicalSlug)).toEqual([
			A.technicalSlug,
			B.technicalSlug,
		]);
		expect(result.selectedCampaign).toBeNull();
	});

	it("projects the selected campaign with campaign and project origins separated", async () => {
		mocks.readAuthorizedCampaignAccess.mockResolvedValue({
			ok: true,
			campaigns: [
				discovered(A, [EDIT_CAPABILITIES.transcriptRead]),
				discovered(B, [
					EDIT_CAPABILITIES.contentEdit,
					EDIT_CAPABILITIES.transcriptRead,
				]),
			],
		});
		const result = await readAccountCampaignAccess(
			context([
				grant(EDIT_CAPABILITIES.contentEdit, "campaign", B.technicalSlug),
				grant(EDIT_CAPABILITIES.transcriptRead, "project", "tda"),
			]),
			B.technicalSlug,
		);
		expect(result.state).toBe("ready");
		if (result.state !== "ready" || !result.selectedCampaign) return;
		expect(result.selectedCampaign.technicalSlug).toBe(B.technicalSlug);
		expect(result.selectedCampaign.projectCapabilityCount).toBe(1);
		expect(result.selectedCampaign.campaignCapabilityCount).toBe(1);
		expect(
			result.selectedCampaign.capabilityGroups.flatMap((group) =>
				group.items.map((item) => [item.capability, item.scope]),
			),
		).toEqual([
			[EDIT_CAPABILITIES.contentEdit, "campaign"],
			[EDIT_CAPABILITIES.transcriptRead, "project"],
		]);
	});

	it("auto-selects exactly one authorized campaign and never enumerates an undiscovered private campaign", async () => {
		mocks.readAuthorizedCampaignAccess.mockResolvedValue({
			ok: true,
			campaigns: [discovered(A, [EDIT_CAPABILITIES.permissionsManage])],
		});
		const result = await readAccountCampaignAccess(
			context([
				grant(
					EDIT_CAPABILITIES.permissionsManage,
					"campaign",
					A.technicalSlug,
				),
			]),
			null,
		);
		expect(result.state).toBe("ready");
		if (result.state !== "ready") return;
		expect(result.campaigns).toEqual([
			{ technicalSlug: A.technicalSlug, name: A.name },
		]);
		expect(result.selectedCampaign?.technicalSlug).toBe(A.technicalSlug);
		expect(JSON.stringify(result)).not.toContain("private-undiscovered");
	});

	it("fails closed when campaign discovery is unavailable instead of reporting no permission", async () => {
		mocks.readAuthorizedCampaignAccess.mockResolvedValue({
			ok: false,
			reason: "dependency_unavailable",
		});
		expect(
			await readAccountCampaignAccess(
				context([
					grant(EDIT_CAPABILITIES.contentEdit, "campaign", A.technicalSlug),
				]),
				null,
			),
		).toEqual({
			state: "unavailable",
			campaigns: [],
			selectedCampaign: null,
			requestedCampaignUnavailable: false,
		});
	});

	it("does not echo or select a forged campaign request", async () => {
		mocks.readAuthorizedCampaignAccess.mockResolvedValue({
			ok: true,
			campaigns: [
				discovered(A, [EDIT_CAPABILITIES.contentEdit]),
				discovered(B, [EDIT_CAPABILITIES.contentEdit]),
			],
		});
		const result = await readAccountCampaignAccess(
			context([grant(EDIT_CAPABILITIES.contentEdit, "project", "tda")]),
			"private-undiscovered",
		);
		expect(result.state).toBe("ready");
		if (result.state !== "ready") return;
		expect(result.selectedCampaign).toBeNull();
		expect(result.requestedCampaignUnavailable).toBe(true);
		expect(JSON.stringify(result)).not.toContain("private-undiscovered");
	});
});
