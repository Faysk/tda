import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readPublicCampaignCovers } from "./campaign-cover-repository";

describe("campaign cover repository", () => {
	it("fails closed when a binding points to a missing asset", async () => {
		const campaignId = "11111111-1111-4111-8111-111111111111";
		const bindingQuery = {
			select: vi.fn(),
			eq: vi.fn(),
			in: vi.fn(),
		};
		bindingQuery.select.mockReturnValue(bindingQuery);
		bindingQuery.eq.mockReturnValue(bindingQuery);
		bindingQuery.in.mockResolvedValue({
			data: [
				{
					campaign_id: campaignId,
					asset_id: "22222222-2222-4222-8222-222222222222",
				},
			],
			error: null,
		});

		const assetQuery = {
			select: vi.fn(),
			in: vi.fn(),
		};
		assetQuery.select.mockReturnValue(assetQuery);
		assetQuery.in
			.mockReturnValueOnce(assetQuery)
			.mockResolvedValueOnce({ data: [], error: null });

		const client = {
			from: vi
				.fn()
				.mockReturnValueOnce(bindingQuery)
				.mockReturnValueOnce(assetQuery),
		};

		const covers = await readPublicCampaignCovers(
			client as never,
			[{ campaignId, campaignMediaKey: "stable-campaign" }],
		);

		expect(covers.size).toBe(0);
		expect(client.from).toHaveBeenNthCalledWith(1, "campaign_media_bindings");
		expect(client.from).toHaveBeenNthCalledWith(2, "media_assets");
	});
});
