import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({
	publishedDataClient: mocks.client,
}));

import { resolveStandaloneLoreCampaignLink } from "./standalone-link-repository";

type TableResult = Readonly<{ data: unknown; error: unknown }>;

function setupCampaignResults(results: TableResult[]) {
	const calls: Array<{ method: string; args: unknown[] }> = [];
	mocks.client.mockReturnValue({
		from: (table: string) => {
			expect(table).toBe("campaigns");
			const result = results.shift() ?? { data: null, error: null };
			const query = Promise.resolve(result);
			for (const method of ["select", "eq", "maybeSingle"]) {
				Object.assign(query, {
					[method]: (...args: unknown[]) => {
						calls.push({ method, args });
						return query;
					},
				});
			}
			return query;
		},
	});
	return calls;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("curated lore campaign boundary", () => {
	it("resolves listed Seika through campaign B using only its public editorial name", async () => {
		const longName =
			"Antes que seja tarde — As histórias que ainda cabem numa noite muito longa";
		const calls = setupCampaignResults([
			{
				data: {
					id: "campaign-b-id",
					slug: "antes-que-seja-tarde",
					name: longName,
				},
				error: null,
			},
			{
				data: {
					public_slug: "antes-que-seja-tarde",
					lifecycle: "active",
					visibility: "public",
				},
				error: null,
			},
		]);

		await expect(resolveStandaloneLoreCampaignLink("seika")).resolves.toEqual({
			campaignId: "campaign-b-id",
			technicalSlug: "antes-que-seja-tarde",
			name: longName,
			publicCampaign: {
				routeKey: "antes-que-seja-tarde",
				name: longName,
			},
		});
		expect(calls).toContainEqual({
			method: "eq",
			args: ["slug", "antes-que-seja-tarde"],
		});
	});

	it("does not expose archived campaign metadata in the public catalogue", async () => {
		setupCampaignResults([
			{
				data: {
					id: "campaign-b-id",
					slug: "antes-que-seja-tarde",
					name: "Antes que seja tarde",
				},
				error: null,
			},
			{
				data: {
					public_slug: "antes-que-seja-tarde",
					lifecycle: "archived",
					visibility: "public",
				},
				error: null,
			},
		]);

		await expect(resolveStandaloneLoreCampaignLink("seika")).resolves.toEqual({
			campaignId: "campaign-b-id",
			technicalSlug: "antes-que-seja-tarde",
			name: "Antes que seja tarde",
			publicCampaign: null,
		});
	});

	it("keeps an unlinked standalone lore completely outside campaign storage lookup", async () => {
		await expect(resolveStandaloneLoreCampaignLink("yllith")).resolves.toBeNull();
		expect(mocks.client).not.toHaveBeenCalled();
	});
});
