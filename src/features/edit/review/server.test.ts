import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	authorize: vi.fn(),
	editDataClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/server", () => ({
	authorizeCampaignCapabilityServer: mocks.authorize,
}));
vi.mock("@/integrations/supabase/server", () => ({
	editDataClient: mocks.editDataClient,
}));

import { loadCanonReviewQueue } from "./server";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("campaign-scoped narrative review queue", () => {
	it("rejects malformed campaign identity before authorization or data access", async () => {
		expect(await loadCanonReviewQueue("../campaign-a")).toEqual({
			ok: false,
			reason: "forbidden",
		});
		expect(mocks.authorize).not.toHaveBeenCalled();
		expect(mocks.editDataClient).not.toHaveBeenCalled();
	});

	it("reauthorizes review and transcript source access against the exact selected campaign", async () => {
		mocks.authorize.mockResolvedValue({ ok: true });
		mocks.editDataClient.mockReturnValue(null);

		expect(await loadCanonReviewQueue("campaign-b")).toEqual({
			ok: false,
			reason: "dependency_unavailable",
		});
		expect(mocks.authorize).toHaveBeenNthCalledWith(1, {
			action: "narrative.review.read",
			campaignSlug: "campaign-b",
		});
		expect(mocks.authorize).toHaveBeenNthCalledWith(2, {
			action: "campaign.transcript.read",
			campaignSlug: "campaign-b",
		});
	});
});
