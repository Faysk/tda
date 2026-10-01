import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDIT_CAPABILITIES, type EditAccessContext } from "@/features/edit/access/policy";

const mocks = vi.hoisted(() => ({
	readAuthorizedCampaigns: vi.fn(),
	readCampaignRegistry: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/campaigns/authorized", () => ({
	readAuthorizedCampaigns: mocks.readAuthorizedCampaigns,
}));
vi.mock("@/features/campaigns/repository", () => ({
	readCampaignRegistry: mocks.readCampaignRegistry,
}));

import { readNavigationCampaigns } from "./navigation";

const context: EditAccessContext = {
	authUserId: "auth-user",
	profileId: "profile-1",
	grants: [],
};

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
						]
					: capability === EDIT_CAPABILITIES.worldLayoutEdit ||
							capability === EDIT_CAPABILITIES.reviewRead
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
	mocks.readCampaignRegistry.mockResolvedValue([
		{
			technicalSlug: "campaign-a",
			routeKey: "campanha-a",
			name: "Campanha A",
			lifecycle: "active",
		},
		{
			technicalSlug: "campaign-b",
			routeKey: "campanha-b",
			name: "Campanha B",
			lifecycle: "active",
		},
		{
			technicalSlug: "private-c",
			routeKey: "privada-c",
			name: "Privada C",
			lifecycle: "active",
		},
	]);
});

describe("campaign-aware navigation projection", () => {
	it("projects only authorized campaigns and keeps World/Review on a non-legacy campaign", async () => {
		await expect(readNavigationCampaigns(context)).resolves.toEqual({
			mode: "first_class",
			campaigns: [
				{
					technicalSlug: "campaign-a",
					routeKey: "campanha-a",
					name: "Campanha A",
					lifecycle: "active",
					capabilities: [EDIT_CAPABILITIES.transcriptRead],
				},
				{
					technicalSlug: "campaign-b",
					routeKey: "campanha-b",
					name: "Campanha B",
					lifecycle: "active",
					capabilities: [
						EDIT_CAPABILITIES.worldLayoutEdit,
						EDIT_CAPABILITIES.reviewRead,
					],
				},
			],
		});
		expect(JSON.stringify(await readNavigationCampaigns(context))).not.toContain(
			"private-c",
		);
	});

	it("treats an unresolved profile as an empty authorized set, not an outage", async () => {
		await expect(
			readNavigationCampaigns({ ...context, profileId: null }),
		).resolves.toEqual({ mode: "first_class", campaigns: [] });
		expect(mocks.readAuthorizedCampaigns).not.toHaveBeenCalled();
		expect(mocks.readCampaignRegistry).not.toHaveBeenCalled();
	});

	it("fails closed when capability discovery or the registry is unavailable", async () => {
		mocks.readAuthorizedCampaigns.mockResolvedValueOnce({
			ok: false,
			reason: "dependency_unavailable",
			campaigns: [],
		});
		await expect(readNavigationCampaigns(context)).resolves.toEqual({
			mode: "unavailable",
			campaigns: [],
		});

		vi.clearAllMocks();
		mocks.readAuthorizedCampaigns.mockResolvedValue({
			ok: true,
			campaigns: [
				{
					technicalSlug: "campaign-a",
					name: "Campanha A",
					lifecycle: "active",
				},
			],
		});
		mocks.readCampaignRegistry.mockResolvedValue(null);
		await expect(readNavigationCampaigns(context)).resolves.toEqual({
			mode: "unavailable",
			campaigns: [],
		});
	});
});
