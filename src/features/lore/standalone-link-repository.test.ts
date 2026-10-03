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

describe("standalone lore campaign linkage", () => {
	it("does not resolve D until the target campaign row exists", async () => {
		setupCampaignResults([{ data: null, error: null }]);
		await expect(resolveStandaloneLoreCampaignLink("d")).resolves.toBeNull();
	});

	it("resolves the editorial link without exposing a private campaign badge", async () => {
		const calls = setupCampaignResults([
			{
				data: {
					id: "campaign-d-id",
					slug: "antes-que-seja-tarde",
					name: "Passos Retomados",
				},
				error: null,
			},
			{
				data: {
					public_slug: "antes-que-seja-tarde",
					lifecycle: "active",
					visibility: "private",
				},
				error: null,
			},
		]);
		await expect(resolveStandaloneLoreCampaignLink("d")).resolves.toEqual({
			campaignId: "campaign-d-id",
			technicalSlug: "antes-que-seja-tarde",
			name: "Passos Retomados",
			publicCampaign: null,
		});
		expect(calls).toContainEqual({
			method: "eq",
			args: ["slug", "antes-que-seja-tarde"],
		});
	});

	it("exposes a badge payload only for an active public registered campaign", async () => {
		setupCampaignResults([
			{
				data: {
					id: "campaign-d-id",
					slug: "antes-que-seja-tarde",
					name: "Passos Retomados",
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
		await expect(resolveStandaloneLoreCampaignLink("d")).resolves.toEqual({
			campaignId: "campaign-d-id",
			technicalSlug: "antes-que-seja-tarde",
			name: "Passos Retomados",
			publicCampaign: {
				routeKey: "antes-que-seja-tarde",
				name: "Passos Retomados",
			},
		});
	});

	it("keeps the internal link but invents no public badge when registry columns are unavailable", async () => {
		setupCampaignResults([
			{
				data: {
					id: "campaign-d-id",
					slug: "antes-que-seja-tarde",
					name: "Passos Retomados",
				},
				error: null,
			},
			{ data: null, error: { code: "42703" } },
		]);
		await expect(resolveStandaloneLoreCampaignLink("d")).resolves.toEqual({
			campaignId: "campaign-d-id",
			technicalSlug: "antes-que-seja-tarde",
			name: "Passos Retomados",
			publicCampaign: null,
		});
	});

	it("uses a campaign-qualified entity link as an explicit campaign binding", async () => {
		const calls = setupCampaignResults([
			{
				data: {
					id: "legacy-campaign-id",
					slug: "yuhara-main",
					name: "Destino Sem Fim",
				},
				error: null,
			},
			{
				data: {
					public_slug: "cronicas-da-mesa",
					lifecycle: "active",
					visibility: "public",
				},
				error: null,
			},
		]);
		await expect(resolveStandaloneLoreCampaignLink("astel")).resolves.toEqual({
			campaignId: "legacy-campaign-id",
			technicalSlug: "yuhara-main",
			name: "Destino Sem Fim",
			publicCampaign: {
				routeKey: "cronicas-da-mesa",
				name: "Destino Sem Fim",
			},
		});
		expect(calls).toContainEqual({
			method: "eq",
			args: ["slug", "yuhara-main"],
		});
	});

	it("does not touch storage for an unknown or unlinked lore slug", async () => {
		await expect(resolveStandaloneLoreCampaignLink("missing-lore")).resolves.toBeNull();
		expect(mocks.client).not.toHaveBeenCalled();
	});
});
