import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	authorizeCampaignCoverTarget: vi.fn(),
	saveCampaignCover: vi.fn(),
	removeCampaignCoverBinding: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/features/world-explorer/world-entity-media", () => ({
	WORLD_ENTITY_MEDIA_MAX_BYTES: 8 * 1024 * 1024,
}));

vi.mock("@/features/campaigns/campaign-cover-access", () => ({
	authorizeCampaignCoverTarget: mocks.authorizeCampaignCoverTarget,
}));

vi.mock("@/features/campaigns/campaign-cover-service", () => ({
	saveCampaignCover: mocks.saveCampaignCover,
	removeCampaignCoverBinding: mocks.removeCampaignCoverBinding,
}));

import { PUT } from "./route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";

function request(headers: Record<string, string> = {}) {
	return new Request(
		`https://dnd.faysk.dev/api/edit/campaign-cover/${CAMPAIGN_ID}`,
		{
			method: "PUT",
			headers: {
				"content-type": "image/png",
				...headers,
			},
			body: new Uint8Array(24),
		},
	);
}

describe("campaign cover upload route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.authorizeCampaignCoverTarget.mockResolvedValue({
			ok: true,
			target: {
				campaignId: CAMPAIGN_ID,
				campaignPublicSlug: "campaign-a",
				campaignTechnicalSlug: "campaign-a",
				visibility: "private",
			},
		});
		mocks.saveCampaignCover.mockResolvedValue({
			assetId: "22222222-2222-4222-8222-222222222222",
			status: "staged",
			publicUrl: null,
		});
	});

	it("accepts a valid body when Content-Length is absent", async () => {
		const upload = request();
		expect(upload.headers.get("content-length")).toBeNull();

		const response = await PUT(upload, {
			params: Promise.resolve({ campaignId: CAMPAIGN_ID }),
		});

		expect(response.status).toBe(200);
		expect(mocks.saveCampaignCover).toHaveBeenCalledOnce();
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/campanhas");
	});

	it.each(["not-a-number", "23", String(8 * 1024 * 1024 + 1)])(
		"rejects an invalid declared Content-Length %s before storage",
		async (contentLength) => {
			const response = await PUT(request({ "content-length": contentLength }), {
				params: Promise.resolve({ campaignId: CAMPAIGN_ID }),
			});

			expect(response.status).toBe(413);
			expect(mocks.authorizeCampaignCoverTarget).not.toHaveBeenCalled();
			expect(mocks.saveCampaignCover).not.toHaveBeenCalled();
		},
	);
});
