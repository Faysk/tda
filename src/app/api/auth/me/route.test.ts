import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	currentAccess: vi.fn(),
 navigation: vi.fn(),
}));

vi.mock("@/features/auth/server", () => ({
	currentAccess: mocks.currentAccess,
}));
vi.mock("@/features/campaigns/navigation", () => ({
 readNavigationCampaigns: mocks.navigation,
}));

import { GET } from "./route";

beforeEach(() => {
	vi.clearAllMocks();
 mocks.navigation.mockResolvedValue({ mode: "first_class", campaigns: [] });
	mocks.currentAccess.mockResolvedValue({
		state: "anonymous",
		context: null,
		identity: null,
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
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("vary")).toBe("Cookie");
	});

	it("returns only sanitized identity and effective capabilities", async () => {
		mocks.currentAccess.mockResolvedValueOnce({
			state: "authenticated_linked",
			identity: {
				displayName: "Renan",
				avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.png",
			},
			context: {
				authUserId: "auth-user-private",
				profileId: "profile-private",
				grants: [
					{
						action: "campaign.local.process",
						scopeType: "campaign",
						scopeId: "yuhara-main",
						status: "active",
						startsAt: "2020-01-01",
						endsAt: null,
					},
				],
			},
		});

		const response = await GET();
		const body = await response.json();

		expect(body).toEqual({
			state: "authenticated_linked",
			scope: { type: "project", id: "tda" },
 campaignsState: "first_class",
 campaigns: [],
			capabilities: [],
			identity: {
				displayName: "Renan",
				avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.png",
			},
		});
		const serialized = JSON.stringify(body);
		expect(serialized).not.toContain("auth-user-private");
		expect(serialized).not.toContain("profile-private");
		expect(serialized).not.toContain("scopeType");
	});

	it("keeps authenticated unlinked accounts distinct with no grants", async () => {
		mocks.currentAccess.mockResolvedValueOnce({
			state: "authenticated_unlinked",
			identity: { displayName: "Corujinha", avatarUrl: null },
			context: {
				authUserId: "private",
				profileId: null,
				grants: [],
			},
		});

		const response = await GET();
		await expect(response.json()).resolves.toEqual({
			state: "authenticated_unlinked",
			scope: { type: "project", id: "tda" },
 campaignsState: "first_class",
 campaigns: [],
			capabilities: [],
			identity: { displayName: "Corujinha", avatarUrl: null },
		});
	});

	it("keeps authenticated users without grants distinct from anonymous", async () => {
		mocks.currentAccess.mockResolvedValueOnce({
			state: "authenticated_linked_no_grants",
			identity: { displayName: null, avatarUrl: null },
			context: {
				authUserId: "private",
				profileId: "profile",
				grants: [],
			},
		});

		const response = await GET();
		await expect(response.json()).resolves.toEqual({
			state: "authenticated_linked_no_grants",
			scope: { type: "project", id: "tda" },
 campaignsState: "first_class",
 campaigns: [],
			capabilities: [],
			identity: { displayName: null, avatarUrl: null },
		});
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
		expect(response.headers.get("cache-control")).toBe("private, no-store");
	});
});
