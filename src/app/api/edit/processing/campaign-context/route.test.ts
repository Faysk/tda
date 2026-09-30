import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const query = {
		select: vi.fn(),
		eq: vi.fn(),
		maybeSingle: vi.fn(),
	};
	query.select.mockReturnValue(query);
	query.eq.mockReturnValue(query);
	return {
		authorizeCampaignCapabilityServer: vi.fn(),
		editDataClient: vi.fn(),
		from: vi.fn(),
		query,
	};
});

vi.mock("@/features/auth/server", () => ({
	authorizeCampaignCapabilityServer: mocks.authorizeCampaignCapabilityServer,
}));
vi.mock("@/features/edit/access/policy", () => ({
	EDIT_CAPABILITIES: {
		localProcess: "campaign.local.process",
	},
}));
vi.mock("@/integrations/supabase/server", () => ({
	editDataClient: mocks.editDataClient,
}));

import { POST } from "./route";

function request(body: unknown) {
	return new Request("http://localhost/api/edit/processing/campaign-context", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.query.select.mockReturnValue(mocks.query);
	mocks.query.eq.mockReturnValue(mocks.query);
	mocks.from.mockReturnValue(mocks.query);
	mocks.editDataClient.mockReturnValue({ from: mocks.from });
	mocks.authorizeCampaignCapabilityServer.mockResolvedValue({
		ok: true,
		authUserId: "auth-user",
		profileId: "profile",
		scope: "campaign",
	});
	mocks.query.maybeSingle.mockResolvedValue({
		data: { slug: "campaign-a" },
		error: null,
	});
});

describe("POST /api/edit/processing/campaign-context", () => {
	it("reauthorizes the exact campaign and requires it to still be active", async () => {
		const response = await POST(request({ campaignSlug: "campaign-a" }));
		await expect(response.json()).resolves.toEqual({
			ok: true,
			campaignSlug: "campaign-a",
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(mocks.authorizeCampaignCapabilityServer).toHaveBeenCalledWith({
			action: "campaign.local.process",
			campaignSlug: "campaign-a",
		});
		expect(mocks.from).toHaveBeenCalledWith("campaigns");
		expect(mocks.query.eq).toHaveBeenCalledWith("slug", "campaign-a");
		expect(mocks.query.eq).toHaveBeenCalledWith("lifecycle", "active");
	});

	it("fails closed when the campaign was archived after the form opened", async () => {
		mocks.query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
		const response = await POST(request({ campaignSlug: "campaign-a" }));
		await expect(response.json()).resolves.toEqual({
			ok: false,
			reason: "campaign_unavailable",
		});
		expect(response.status).toBe(409);
	});

	it("does not disclose whether an unauthorized campaign exists", async () => {
		mocks.authorizeCampaignCapabilityServer.mockResolvedValueOnce({
			ok: false,
			reason: "forbidden",
		});
		const response = await POST(request({ campaignSlug: "campaign-b" }));
		await expect(response.json()).resolves.toEqual({
			ok: false,
			reason: "campaign_unavailable",
		});
		expect(response.status).toBe(403);
		expect(mocks.editDataClient).not.toHaveBeenCalled();
	});

	it("fails closed when authorization or registry dependencies are unavailable", async () => {
		mocks.authorizeCampaignCapabilityServer.mockResolvedValueOnce({
			ok: false,
			reason: "dependency_unavailable",
		});
		const authFailure = await POST(request({ campaignSlug: "campaign-a" }));
		expect(authFailure.status).toBe(503);

		mocks.authorizeCampaignCapabilityServer.mockResolvedValueOnce({
			ok: true,
			authUserId: "auth-user",
		});
		mocks.editDataClient.mockReturnValueOnce(null);
		const registryFailure = await POST(request({ campaignSlug: "campaign-a" }));
		expect(registryFailure.status).toBe(503);
	});

	it("rejects malformed campaign identities before authorization", async () => {
		const response = await POST(request({ campaignSlug: "../private" }));
		expect(response.status).toBe(400);
		expect(mocks.authorizeCampaignCapabilityServer).not.toHaveBeenCalled();
	});
});
