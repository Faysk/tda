import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	publishedDataClient: vi.fn(),
	editDataClient: vi.fn(),
	readPublicCampaignCovers: vi.fn(),
	readCampaignCoverStates: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({
	publishedDataClient: mocks.publishedDataClient,
	editDataClient: mocks.editDataClient,
}));
vi.mock("./campaign-cover-repository", () => ({
	readPublicCampaignCovers: mocks.readPublicCampaignCovers,
	readCampaignCoverStates: mocks.readCampaignCoverStates,
}));

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

function queryWith(result: QueryResult) {
	const query: Record<string, unknown> = {};
	for (const method of ["select", "eq", "not", "order", "is", "range"]) {
		query[method] = vi.fn(() => query);
	}
	query.maybeSingle = vi.fn().mockResolvedValue(result);
	query.single = vi.fn().mockResolvedValue(result);
	return query as {
		select: ReturnType<typeof vi.fn>;
		eq: ReturnType<typeof vi.fn>;
		not: ReturnType<typeof vi.fn>;
		order: ReturnType<typeof vi.fn>;
		is: ReturnType<typeof vi.fn>;
		range: ReturnType<typeof vi.fn>;
		maybeSingle: ReturnType<typeof vi.fn>;
		single: ReturnType<typeof vi.fn>;
	};
}

function directoryQueryWith(result: QueryResult) {
	const query = queryWith(result);
	query.order
		.mockReturnValueOnce(query)
		.mockResolvedValueOnce(result);
	return query;
}

function clientWith(...queries: ReturnType<typeof queryWith>[]) {
	let index = 0;
	return {
		from: vi.fn(() => {
			const query = queries[index++];
			if (!query) throw new Error("unexpected query");
			return query;
		}),
	};
}

import {
	readCampaignRegistry,
	readPublicCampaignDirectory,
	resolvePublicCampaignRoute,
} from "./repository";

const legacyRow = {
	slug: "yuhara-main",
	name: "Destino Sem Fim",
	description: "Campanha histórica",
};

describe("public campaign registry compatibility", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.editDataClient.mockReturnValue(null);
		mocks.readPublicCampaignCovers.mockResolvedValue(new Map());
		mocks.readCampaignCoverStates.mockResolvedValue(new Map());
	});

	it("restores the legacy public directory on a real PostgreSQL 42703 SELECT gap", async () => {
		const registry = directoryQueryWith({
			data: null,
			error: {
				code: "42703",
				message: 'column campaigns.lifecycle does not exist',
			},
		});
		const legacy = queryWith({ data: legacyRow, error: null });
		const client = clientWith(registry, legacy);
		mocks.publishedDataClient.mockReturnValue(client);

		await expect(readPublicCampaignDirectory()).resolves.toEqual({
			ok: true,
			registryMode: "legacy",
			campaigns: [
				{
					routeKey: "cronicas-da-mesa",
					name: "Destino Sem Fim",
					description: "Campanha histórica",
					coverImage: null,
				},
			],
		});
		expect(client.from).toHaveBeenCalledTimes(2);
		expect(legacy.eq).toHaveBeenCalledWith("slug", "yuhara-main");
	});

	it("restores the canonical legacy route on a PostgREST schema-cache gap", async () => {
		const registry = queryWith({
			data: null,
			error: {
				code: "PGRST204",
				message:
					"Could not find the 'public_slug' column of 'campaigns' in the schema cache",
			},
		});
		const legacy = queryWith({ data: legacyRow, error: null });
		mocks.publishedDataClient.mockReturnValue(clientWith(registry, legacy));

		await expect(resolvePublicCampaignRoute("cronicas-da-mesa")).resolves.toEqual({
			ok: true,
			campaign: {
				technicalSlug: "yuhara-main",
				routeKey: "cronicas-da-mesa",
				name: "Destino Sem Fim",
				description: "Campanha histórica",
				coverImage: null,
			},
			canonical: true,
		});
	});

	it("keeps the historical technical slug as a redirect-only alias before migration", async () => {
		const registry = queryWith({
			data: null,
			error: {
				code: "42703",
				message: 'column campaigns.visibility does not exist',
			},
		});
		const legacy = queryWith({ data: legacyRow, error: null });
		mocks.publishedDataClient.mockReturnValue(clientWith(registry, legacy));

		const result = await resolvePublicCampaignRoute("yuhara-main");
		expect(result).toMatchObject({
			ok: true,
			campaign: { routeKey: "cronicas-da-mesa", technicalSlug: "yuhara-main" },
			canonical: false,
		});
	});

	it("keeps a campaign cover stable when an old public route resolves through an alias", async () => {
		const campaignId = "11111111-1111-4111-8111-111111111111";
		const coverUrl =
			"https://media.dnd.faysk.dev/campaigns/stable-campaign/campaign/cover/" +
			"a".repeat(64) +
			".webp";
		const canonical = queryWith({ data: null, error: null });
		const alias = queryWith({ data: { campaign_id: campaignId }, error: null });
		const resolved = queryWith({
			data: {
				id: campaignId,
				slug: "stable-campaign",
				public_slug: "renamed-public-route",
				name: "Campaign renamed in public",
				description: "Alias keeps the same storage identity.",
			},
			error: null,
		});
		const client = clientWith(canonical, alias, resolved);
		mocks.publishedDataClient.mockReturnValue(client);
		mocks.readPublicCampaignCovers.mockResolvedValue(
			new Map([[campaignId, coverUrl]]),
		);

		await expect(resolvePublicCampaignRoute("old-public-route")).resolves.toEqual({
			ok: true,
			campaign: {
				technicalSlug: "stable-campaign",
				routeKey: "renamed-public-route",
				name: "Campaign renamed in public",
				description: "Alias keeps the same storage identity.",
				coverImage: coverUrl,
			},
			canonical: false,
		});
		expect(mocks.readPublicCampaignCovers).toHaveBeenCalledWith(client, [
			{ campaignId, campaignMediaKey: "stable-campaign" },
		]);
	});

	it("preserves a private cover binding in Edit without inventing a public URL", async () => {
		const campaignId = "11111111-1111-4111-8111-111111111111";
		const row = {
			id: campaignId,
			slug: "private-campaign",
			public_slug: "private-campaign",
			name: "Private Campaign",
			description: null,
			lifecycle: "active",
			visibility: "private",
			archived_at: null,
			updated_at: "2026-10-01T12:00:00.000Z",
		};
		const registry = directoryQueryWith({ data: [row], error: null });
		const client = clientWith(registry);
		mocks.editDataClient.mockReturnValue(client);
		mocks.readCampaignCoverStates.mockResolvedValue(
			new Map([
				[campaignId, { hasBinding: true, publicUrl: null }],
			]),
		);

		await expect(readCampaignRegistry()).resolves.toEqual([
			{
				id: campaignId,
				technicalSlug: "private-campaign",
				routeKey: "private-campaign",
				name: "Private Campaign",
				description: null,
				lifecycle: "active",
				visibility: "private",
				archivedAt: null,
				updatedAt: "2026-10-01T12:00:00.000Z",
				coverImage: null,
				hasCoverBinding: true,
			},
		]);
	});

	it("does not use legacy fallback for unknown routes when the registry is absent", async () => {
		const registry = queryWith({
			data: null,
			error: {
				code: "42703",
				message: 'column campaigns.public_slug does not exist',
			},
		});
		const client = clientWith(registry);
		mocks.publishedDataClient.mockReturnValue(client);

		await expect(resolvePublicCampaignRoute("private-campaign")).resolves.toEqual({
			ok: false,
			reason: "not_found",
		});
		expect(client.from).toHaveBeenCalledTimes(1);
	});

	it("does not hide unrelated database failures behind compatibility", async () => {
		const registry = directoryQueryWith({
			data: null,
			error: {
				code: "42501",
				message: "permission denied for table campaigns",
			},
		});
		const client = clientWith(registry);
		mocks.publishedDataClient.mockReturnValue(client);

		await expect(readPublicCampaignDirectory()).resolves.toEqual({
			ok: false,
			reason: "dependency_unavailable",
		});
		expect(client.from).toHaveBeenCalledTimes(1);
	});

	it("never opens legacy fallback when the new registry query succeeds with no eligible campaign", async () => {
		const registry = directoryQueryWith({ data: [], error: null });
		const client = clientWith(registry);
		mocks.publishedDataClient.mockReturnValue(client);

		await expect(readPublicCampaignDirectory()).resolves.toEqual({
			ok: true,
			registryMode: "canonical",
			campaigns: [],
		});
		expect(client.from).toHaveBeenCalledTimes(1);
		expect(registry.eq).toHaveBeenCalledWith("lifecycle", "active");
		expect(registry.eq).toHaveBeenCalledWith("visibility", "public");
	});
});
