import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditAccessContext } from "@/features/edit/access/policy";

const mocks = vi.hoisted(() => ({
	readAuthorizedCampaigns: vi.fn(),
	loadEditAccessContext: vi.fn(),
	loadPublicCampaigns: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/campaigns/authorized", () => ({
	readAuthorizedCampaigns: mocks.readAuthorizedCampaigns,
}));
vi.mock("@/features/edit/access/repository", () => ({
	loadEditAccessContext: mocks.loadEditAccessContext,
}));
vi.mock("./repository", () => ({
	loadLembraCampaignClassifications: mocks.loadPublicCampaigns,
}));

import {
	loadLembraCampaignContext,
	resolveLembraCampaignSelection,
} from "./campaign-directory";

const publicCampaign = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Destino Sem Fim",
	lifecycle: "active" as const,
};
const privateCampaign = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "Passos Retomados",
	lifecycle: "active" as const,
};

function managerContext(): EditAccessContext {
	return {
		authUserId: "auth-a",
		profileId: "profile-a",
		grants: [
			{
				action: "project.campaigns.manage",
				scopeType: "project",
				scopeId: "tda",
				status: "active",
				startsAt: "2026-01-01T00:00:00Z",
				endsAt: null,
			},
		],
	};
}

describe("Lembra privacy-safe campaign directory", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadPublicCampaigns.mockResolvedValue([publicCampaign]);
		mocks.loadEditAccessContext.mockResolvedValue(managerContext());
		mocks.readAuthorizedCampaigns.mockResolvedValue({
			ok: true,
			campaigns: [
				{
					...privateCampaign,
					technicalSlug: "passos-retomados",
					visibility: "private",
				},
			],
		});
	});

	it("unions public classifications with private campaigns from canonical authorized discovery", async () => {
		await expect(loadLembraCampaignContext("auth-a")).resolves.toEqual({
			campaigns: [publicCampaign, privateCampaign],
			canManageCampaigns: true,
		});
		expect(mocks.readAuthorizedCampaigns).toHaveBeenCalledWith(
			expect.objectContaining({ authUserId: "auth-a" }),
			"campaign.edit.access",
			{ includeArchived: true },
		);
	});

	it("fails private metadata closed while keeping the public library usable", async () => {
		mocks.loadEditAccessContext.mockRejectedValue(new Error("rbac unavailable"));

		await expect(loadLembraCampaignContext("auth-a")).resolves.toEqual({
			campaigns: [publicCampaign],
			canManageCampaigns: false,
		});
		await expect(
			resolveLembraCampaignSelection("auth-a", privateCampaign.id),
		).resolves.toBeNull();
	});
});
