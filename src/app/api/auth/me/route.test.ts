import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	currentAccess: vi.fn(),
	readNavigationCampaigns: vi.fn(),
}));

vi.mock("@/features/auth/server", () => ({
	currentAccess: mocks.currentAccess,
}));
vi.mock("@/features/campaigns/navigation", () => ({
	readNavigationCampaigns: mocks.readNavigationCampaigns,
}));

import { GET } from "./route";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.currentAccess.mockResolvedValue({
		state: "anonymous",
		context: null,
		identity: null,
	});
	mocks.readNavigationCampaigns.mockResolvedValue({
		mode: "first_class",
		campaigns: [],
	});
});

describe("GET /api/auth/me", () => {
	it("keeps anonymous navigation minimal and private", async () => {
		const response = await GET();
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			state: "anonymous",
			scope: { type: "project", id: "tda" },
			campaignsState: "none",
			campaigns: [],
		});
		expect(body).not.toHaveProperty("identity");
		expect(body).not.toHaveProperty("capabilities");
		expect(mocks.readNavigationCampaigns).not.toHaveBeenCalled();
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("vary")).toBe("Cookie");
	});

	it("returns only sanitized identity and authorized campaign projection", async () => {
		const context = {
			authUserId: "auth-user-private",
			profileId: "profile-private",
			grants: [{ action: "campaign.local.process" }],
		};
		mocks.currentAccess.mockResolvedValueOnce({
			state: "authenticated_linked",
			identity: {
				displayName: "Renan",
				avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.png",
			},
			context,
		});
		mocks.readNavigationCampaigns.mockResolvedValueOnce({
			mode: "first_class",
			campaigns: [
				{
					technicalSlug: "yuhara-main",
					routeKey: "cronicas-da-mesa",
					name: "Crônicas da Mesa",
					lifecycle: "active",
					capabilities: ["campaign.local.process"],
				},
			],
		});

		const response = await GET();
		const body = await response.json();

		expect(mocks.readNavigationCampaigns).toHaveBeenCalledWith(context);
		expect(body).toEqual({
			state: "authenticated_linked",
			scope: { type: "project", id: "tda" },
			capabilities: [],
			identity: {
				displayName: "Renan",
				avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.png",
			},
			campaignsState: "first_class",
			campaigns: [
				{
					technicalSlug: "yuhara-main",
					routeKey: "cronicas-da-mesa",
					name: "Crônicas da Mesa",
					lifecycle: "active",
					capabilities: ["campaign.local.process"],
				},
			],
		});
		const serialized = JSON.stringify(body);
		expect(serialized).not.toContain("auth-user-private");
		expect(serialized).not.toContain("profile-private");
		expect(serialized).not.toContain("scopeType");
	});

	it("keeps authenticated unlinked accounts empty without reporting an outage", async () => {
		const context = {
			authUserId: "private",
			profileId: null,
			grants: [],
		};
		mocks.currentAccess.mockResolvedValueOnce({
			state: "authenticated_unlinked",
			identity: { displayName: "Corujinha", avatarUrl: null },
			context,
		});

		const response = await GET();
		await expect(response.json()).resolves.toEqual({
			state: "authenticated_unlinked",
			scope: { type: "project", id: "tda" },
			capabilities: [],
			identity: { displayName: "Corujinha", avatarUrl: null },
			campaignsState: "first_class",
			campaigns: [],
		});
		expect(mocks.readNavigationCampaigns).toHaveBeenCalledWith(context);
	});

	it("keeps authenticated users without grants distinct from anonymous", async () => {
		const context = {
			authUserId: "private",
			profileId: "profile",
			grants: [],
		};
		mocks.currentAccess.mockResolvedValueOnce({
			state: "authenticated_linked_no_grants",
			identity: { displayName: null, avatarUrl: null },
			context,
		});

		const response = await GET();
		await expect(response.json()).resolves.toEqual({
			state: "authenticated_linked_no_grants",
			scope: { type: "project", id: "tda" },
			capabilities: [],
			identity: { displayName: null, avatarUrl: null },
			campaignsState: "first_class",
			campaigns: [],
		});
		expect(mocks.readNavigationCampaigns).toHaveBeenCalledWith(context);
	});

	it("returns 503 for unavailable access without exposing a stale private projection", async () => {
		mocks.currentAccess.mockResolvedValueOnce({
			state: "unavailable",
			context: null,
			identity: { displayName: "Verified upstream", avatarUrl: null },
		});

		const response = await GET();
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body).toEqual({
			state: "unavailable",
			scope: { type: "project", id: "tda" },
			campaignsState: "unavailable",
			campaigns: [],
		});
		expect(body).not.toHaveProperty("identity");
		expect(body).not.toHaveProperty("capabilities");
		expect(mocks.readNavigationCampaigns).not.toHaveBeenCalled();
		expect(response.headers.get("cache-control")).toBe("private, no-store");
	});
});
