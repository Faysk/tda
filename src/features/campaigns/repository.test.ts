import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	publishedDataClient: vi.fn(),
	editDataClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({
	publishedDataClient: mocks.publishedDataClient,
	editDataClient: mocks.editDataClient,
}));

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

function queryWith(result: QueryResult) {
	const query: Record<string, unknown> = {};
	for (const method of ["select", "eq", "not", "order", "is", "range"]) {
		query[method] = vi.fn(() => query);
	}
	query.maybeSingle = vi.fn().mockResolvedValue(result);
	query.single = vi.fn().mockResolvedValue(result);
	query.then = (
		resolve: (value: QueryResult) => unknown,
		reject?: (reason: unknown) => unknown,
	) => Promise.resolve(result).then(resolve, reject);
	return query as {
		select: ReturnType<typeof vi.fn>;
		eq: ReturnType<typeof vi.fn>;
		not: ReturnType<typeof vi.fn>;
		order: ReturnType<typeof vi.fn>;
		is: ReturnType<typeof vi.fn>;
		range: ReturnType<typeof vi.fn>;
		maybeSingle: ReturnType<typeof vi.fn>;
		single: ReturnType<typeof vi.fn>;
		then: (
			resolve: (value: QueryResult) => unknown,
			reject?: (reason: unknown) => unknown,
		) => Promise<unknown>;
	};
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
	readPublicCampaignDirectory,
	resolvePublicCampaignRoute,
} from "./repository";

const legacyRow = {
	slug: "yuhara-main",
	name: "Crônicas da Mesa",
	description: "Campanha histórica",
};

describe("public campaign registry compatibility", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.editDataClient.mockReturnValue(null);
	});

	it("restores the legacy public directory on a real PostgreSQL 42703 SELECT gap", async () => {
		const registry = queryWith({
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
			campaigns: [
				{
					routeKey: "cronicas-da-mesa",
					name: "Crônicas da Mesa",
					description: "Campanha histórica",
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
				name: "Crônicas da Mesa",
				description: "Campanha histórica",
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
		const registry = queryWith({
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
		const registry = queryWith({ data: [], error: null });
		const client = clientWith(registry);
		mocks.publishedDataClient.mockReturnValue(client);

		await expect(readPublicCampaignDirectory()).resolves.toEqual({
			ok: true,
			campaigns: [],
		});
		expect(client.from).toHaveBeenCalledTimes(1);
		expect(registry.eq).toHaveBeenCalledWith("lifecycle", "active");
		expect(registry.eq).toHaveBeenCalledWith("visibility", "public");
	});
});
