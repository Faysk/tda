import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getVerifiedServerIdentity: vi.fn(),
	loadEditAccessContext: vi.fn(),
	createCampaignRegistryEntry: vi.fn(),
	readCampaignRegistry: vi.fn(),
	updateCampaignLifecycle: vi.fn(),
	updateCampaignRegistryEntry: vi.fn(),
	readPublicCampaignDirectory: vi.fn(),
	resolvePublicCampaignRoute: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/server", () => ({
	getVerifiedServerIdentity: mocks.getVerifiedServerIdentity,
}));
vi.mock("@/features/edit/access/repository", () => ({
	loadEditAccessContext: mocks.loadEditAccessContext,
}));
vi.mock("./repository", () => ({
	createCampaignRegistryEntry: mocks.createCampaignRegistryEntry,
	readCampaignRegistry: mocks.readCampaignRegistry,
	updateCampaignLifecycle: mocks.updateCampaignLifecycle,
	updateCampaignRegistryEntry: mocks.updateCampaignRegistryEntry,
	readPublicCampaignDirectory: mocks.readPublicCampaignDirectory,
	resolvePublicCampaignRoute: mocks.resolvePublicCampaignRoute,
}));

import { createCampaign } from "./server";

const INPUT = {
	name: "Nova campanha",
	technicalSlug: "nova-campanha",
	routeKey: "nova-campanha",
	description: "",
	visibility: "public",
};

describe("campaign registry server authorization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getVerifiedServerIdentity.mockResolvedValue({
			ok: true,
			authUserId: "auth-user",
		});
	});

	it("denies a direct create request without project.campaigns.manage before any write", async () => {
		mocks.loadEditAccessContext.mockResolvedValue({
			authUserId: "auth-user",
			profileId: "11111111-1111-4111-8111-111111111111",
			grants: [],
		});

		await expect(createCampaign(INPUT)).resolves.toEqual({
			ok: false,
			reason: "forbidden",
		});
		expect(mocks.createCampaignRegistryEntry).not.toHaveBeenCalled();
	});

	it("does not promote a campaign-scoped grant into project campaign management", async () => {
		mocks.loadEditAccessContext.mockResolvedValue({
			authUserId: "auth-user",
			profileId: "11111111-1111-4111-8111-111111111111",
			grants: [
				{
					action: "project.campaigns.manage",
					scopeType: "campaign",
					scopeId: "nova-campanha",
					status: "active",
					startsAt: "2026-01-01T00:00:00Z",
					endsAt: null,
				},
			],
		});

		await expect(createCampaign(INPUT)).resolves.toEqual({
			ok: false,
			reason: "forbidden",
		});
		expect(mocks.createCampaignRegistryEntry).not.toHaveBeenCalled();
	});
});
