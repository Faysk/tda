import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	authorizeCampaignCapabilityServer: vi.fn(),
	getVerifiedServerIdentity: vi.fn(),
	editDataClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/features/auth/server", () => ({
	authorizeCampaignCapabilityServer: mocks.authorizeCampaignCapabilityServer,
	getVerifiedServerIdentity: mocks.getVerifiedServerIdentity,
}));

vi.mock("@/integrations/supabase/server", () => ({
	editDataClient: mocks.editDataClient,
}));

import { authorizeWorldEntityMediaAsset } from "./world-entity-media-access";

describe("World entity media asset access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("authenticates before resolving asset ownership", async () => {
		mocks.getVerifiedServerIdentity.mockResolvedValue({
			ok: false,
			reason: "unauthenticated",
		});

		await expect(
			authorizeWorldEntityMediaAsset(
				"11111111-1111-4111-8111-111111111111",
			),
		).resolves.toEqual({ ok: false, reason: "unauthenticated" });

		expect(mocks.editDataClient).not.toHaveBeenCalled();
		expect(mocks.authorizeCampaignCapabilityServer).not.toHaveBeenCalled();
	});
});
