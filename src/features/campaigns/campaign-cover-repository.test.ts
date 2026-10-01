import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readPublicCampaignCovers } from "./campaign-cover-repository";

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

function thenableQuery(result: QueryResult) {
	const query: Record<string, unknown> = {};
	for (const method of ["select", "eq", "in"]) {
		query[method] = vi.fn(() => query);
	}
	query.then = (
		resolve: (value: QueryResult) => unknown,
		reject: (reason?: unknown) => unknown,
	) => Promise.resolve(result).then(resolve, reject);
	return query;
}

describe("campaign cover repository", () => {
	it("fails closed when a binding points to a missing asset", async () => {
		const campaignId = "11111111-1111-4111-8111-111111111111";
		const bindingQuery = thenableQuery({
			data: [
				{
					campaign_id: campaignId,
					asset_id: "22222222-2222-4222-8222-222222222222",
				},
			],
			error: null,
		});
		const assetQuery = thenableQuery({ data: [], error: null });
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
