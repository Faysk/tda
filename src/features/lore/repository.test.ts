import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoreCampaignContext } from "./model";

const mocks = vi.hoisted(() => ({
	client: vi.fn(),
	loadPortraits: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({
	publishedDataClient: mocks.client,
}));
vi.mock("@/features/world-explorer/world-entity-media-repository", () => ({
	loadWorldEntityPortraitPresentations: mocks.loadPortraits,
}));

import {
	findPublishedLoreProfile,
	listPublishedLoreIndex,
} from "./repository";

const campaignA: LoreCampaignContext = {
	routeKey: "campaign-a",
	technicalSlug: "campaign-a-tech",
	name: "Campaign A",
};

type QueryCall = Readonly<{
	table: string;
	method: string;
	args: unknown[];
}>;

type TableResult = Readonly<{ data: unknown; error: unknown }>;

function setupTableResults(results: Record<string, TableResult[]>) {
	const calls: QueryCall[] = [];
	mocks.client.mockReturnValue({
		from: (table: string) => {
			const result = (results[table] ?? []).shift() ?? {
				data: [],
				error: null,
			};
			const query = Promise.resolve(result);
			for (const method of [
				"select",
				"eq",
				"in",
				"order",
				"limit",
				"maybeSingle",
			]) {
				Object.assign(query, {
					[method]: (...args: unknown[]) => {
						calls.push({ table, method, args });
						return query;
					},
				});
			}
			return query;
		},
	});
	return calls;
}

function hasCall(
	calls: readonly QueryCall[],
	table: string,
	method: string,
	args: unknown[],
) {
	return calls.some(
		(call) =>
			call.table === table &&
			call.method === method &&
			JSON.stringify(call.args) === JSON.stringify(args),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.loadPortraits.mockResolvedValue(new Map());
});

describe("campaign-aware public lore repository", () => {
	it("qualifies entity, canon, session and portrait reads with the same campaign", async () => {
		const calls = setupTableResults({
			campaigns: [{ data: { id: "campaign-a-id" }, error: null }],
			entities: [
				{
					data: {
						id: "entity-a-id",
						name: "Same",
						slug: "same",
						entity_type: "pc",
						status: "active",
						visibility: "public_web",
						summary: "Resumo A",
						aliases: [],
					},
					error: null,
				},
			],
			canon_entries: [{ data: [], error: null }],
			participants: [
				{ data: [{ session_id: "session-a-id" }], error: null },
			],
			sessions: [
				{
					data: [
						{
							source_session_id: "shared-source",
							title: "Sessão A",
							session_date: "2026-09-30",
							arc: "A",
							summary_short: "Resumo",
							status: "published",
							campaigns: { slug: campaignA.technicalSlug },
						},
					],
					error: null,
				},
			],
		});
		const profile = await findPublishedLoreProfile(
			"personagens",
			"same",
			campaignA,
		);
		expect(profile?.identity.id).toBe("campaign-a:same");
		expect(profile?.campaign).toEqual(campaignA);
		expect(JSON.stringify(profile)).toContain(
			"/campanhas/campaign-a/sessoes/shared-source",
		);
		expect(
			hasCall(calls, "campaigns", "eq", ["slug", campaignA.technicalSlug]),
		).toBe(true);
		expect(
			hasCall(calls, "entities", "eq", ["campaign_id", "campaign-a-id"]),
		).toBe(true);
		expect(hasCall(calls, "entities", "eq", ["slug", "same"])).toBe(true);
		expect(
			hasCall(calls, "canon_entries", "eq", ["campaign_id", "campaign-a-id"]),
		).toBe(true);
		expect(
			hasCall(calls, "sessions", "eq", ["campaign_id", "campaign-a-id"]),
		).toBe(true);
		expect(
			hasCall(calls, "sessions", "eq", [
				"campaigns.slug",
				campaignA.technicalSlug,
			]),
		).toBe(true);
		expect(mocks.loadPortraits).toHaveBeenCalledWith(
			expect.anything(),
			"campaign-a-id",
			campaignA.technicalSlug,
			["entity-a-id"],
		);
	});

	it("scopes indexes to the resolved campaign before projecting cards", async () => {
		const calls = setupTableResults({
			campaigns: [{ data: { id: "campaign-a-id" }, error: null }],
			entities: [
				{
					data: [
						{
							id: "entity-a-id",
							name: "Same",
							slug: "same",
							entity_type: "pc",
							status: "active",
							visibility: "public_web",
							summary: "",
							aliases: [],
						},
					],
					error: null,
				},
			],
		});
		await expect(
			listPublishedLoreIndex("personagens", campaignA),
		).resolves.toMatchObject([
			{
				slug: "same",
				href: "/campanhas/campaign-a/personagens/same",
				campaign: campaignA,
			},
		]);
		expect(
			hasCall(calls, "entities", "eq", ["campaign_id", "campaign-a-id"]),
		).toBe(true);
		expect(
			hasCall(calls, "entities", "eq", ["visibility", "public_web"]),
		).toBe(true);
	});

	it("returns no profile when the campaign exists but the entity slug is absent", async () => {
		const calls = setupTableResults({
			campaigns: [{ data: { id: "campaign-a-id" }, error: null }],
			entities: [{ data: null, error: null }],
		});
		await expect(
			findPublishedLoreProfile("personagens", "missing", campaignA),
		).resolves.toBeNull();
		expect(
			hasCall(calls, "entities", "eq", ["campaign_id", "campaign-a-id"]),
		).toBe(true);
		expect(hasCall(calls, "entities", "eq", ["slug", "missing"])).toBe(true);
	});

	it("returns no profile when the requested campaign is absent instead of falling back globally", async () => {
		const calls = setupTableResults({
			campaigns: [{ data: null, error: null }],
		});
		await expect(
			findPublishedLoreProfile("personagens", "same", campaignA),
		).resolves.toBeNull();
		expect(calls.some((call) => call.table === "entities")).toBe(false);
	});
});
