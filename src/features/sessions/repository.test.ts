import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	publishedDataClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({
	publishedDataClient: mocks.publishedDataClient,
}));

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

function queryWith(result: QueryResult) {
	const query: Record<string, unknown> = {};
	for (const method of ["select", "eq", "order"]) {
		query[method] = vi.fn(() => query);
	}
	query.range = vi.fn().mockResolvedValue(result);
	query.maybeSingle = vi.fn().mockResolvedValue(result);
	return query as {
		select: ReturnType<typeof vi.fn>;
		eq: ReturnType<typeof vi.fn>;
		order: ReturnType<typeof vi.fn>;
		range: ReturnType<typeof vi.fn>;
		maybeSingle: ReturnType<typeof vi.fn>;
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
	PublishedSessionUnavailableError,
	findPublishedSession,
	listPublishedSessions,
} from "./repository";

const legacySession = {
	source_session_id: "session-legacy",
	title: "Memória preservada",
	session_date: "2026-09-29",
	arc: "Arco legado",
	summary_short: "Resumo público",
	status: "published",
	campaigns: {
		id: "campaign-legacy",
		slug: "yuhara-main",
		name: "Crônicas da Mesa",
	},
};

describe("published session registry compatibility", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("retries the archive through the legacy projection on PostgreSQL 42703", async () => {
		const registry = queryWith({
			data: null,
			error: {
				code: "42703",
				message: 'column campaigns_1.lifecycle does not exist',
			},
		});
		const legacy = queryWith({
			data: [
				legacySession,
				{
					...legacySession,
					source_session_id: "session-review",
					status: "ready_for_review",
				},
			],
			error: null,
		});
		const client = clientWith(registry, legacy);
		mocks.publishedDataClient.mockReturnValue(client);

		const sessions = await listPublishedSessions();
		expect(sessions).toHaveLength(1);
		expect(sessions?.[0]).toMatchObject({
			id: "session-legacy",
			campaignSlug: "cronicas-da-mesa",
			campaignTechnicalSlug: "yuhara-main",
			campaignName: "Crônicas da Mesa",
		});
		expect(client.from).toHaveBeenCalledTimes(2);
		expect(legacy.eq).toHaveBeenCalledWith("campaigns.slug", "yuhara-main");
	});

	it("restores a legacy session detail only inside the known public campaign", async () => {
		const registry = queryWith({
			data: null,
			error: {
				code: "42703",
				message: 'column campaigns_1.public_slug does not exist',
			},
		});
		const legacy = queryWith({
			data: { ...legacySession, summary_full: "Resumo completo" },
			error: null,
		});
		mocks.publishedDataClient.mockReturnValue(clientWith(registry, legacy));

		await expect(
			findPublishedSession("cronicas-da-mesa", "session-legacy"),
		).resolves.toMatchObject({
			id: "session-legacy",
			campaignSlug: "cronicas-da-mesa",
			fullSummary: "Resumo completo",
		});
	});

	it("keeps unrelated database failures distinguishable from legacy compatibility", async () => {
		const registry = queryWith({
			data: null,
			error: {
				code: "42501",
				message: "permission denied for table sessions",
			},
		});
		const client = clientWith(registry);
		mocks.publishedDataClient.mockReturnValue(client);

		await expect(listPublishedSessions()).rejects.toBeInstanceOf(
			PublishedSessionUnavailableError,
		);
		expect(client.from).toHaveBeenCalledTimes(1);
	});

	it("does not use the legacy campaign to satisfy another campaign route", async () => {
		const registry = queryWith({
			data: null,
			error: {
				code: "42703",
				message: 'column campaigns_1.visibility does not exist',
			},
		});
		const client = clientWith(registry);
		mocks.publishedDataClient.mockReturnValue(client);

		await expect(
			findPublishedSession("another-campaign", "session-legacy"),
		).rejects.toBeInstanceOf(PublishedSessionUnavailableError);
		expect(client.from).toHaveBeenCalledTimes(1);
	});
});
