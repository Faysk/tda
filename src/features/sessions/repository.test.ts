import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ responses: [] as unknown[], calls: [] as Array<{table: string; filters: unknown[][]}> }));
vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({ publishedDataClient: () => ({ from: (table: string) => {
	const call = { table, filters: [] as unknown[][] }; m.calls.push(call);
	const q: Record<string, unknown> = {};
	for (const name of ["select", "eq", "order", "range", "maybeSingle", "limit", "or", "is", "gt"])
		q[name] = (...args: unknown[]) => { call.filters.push([name, ...args]); return q; };
	q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(m.responses.shift()).then(resolve);
	return q;
} }) }));
import { listPublishedSessions, listHomePublishedSessions, findLegacyPublishedSession, findAdjacentPublishedSessions } from "./repository";
import { toPublishedSession } from "./model";
const row = { source_session_id: "shared", title: "Synthetic", session_date: "2026-10-01", arc: "", summary_short: "", status: "published", campaigns: { id: "a", name: "A", slug: "yuhara-main", public_slug: "cronicas-da-mesa", lifecycle: "active", visibility: "public" } };
beforeEach(() => { m.responses = []; m.calls = []; vi.stubEnv("TDA_E2E_FIXTURES", "false"); });

it.each(["42703", "PGRST204"])("restores only legacy published rows on registry column error %s", async (code) => {
	m.responses = [{ error: { code, message: "column campaigns_1.public_slug does not exist" } }, { data: [row], error: null }];
	expect(await listPublishedSessions()).toHaveLength(1);
	expect(m.calls[1].filters).toContainEqual(["eq", "campaigns.slug", "yuhara-main"]);
	expect(m.calls[1].filters).toContainEqual(["eq", "status", "published"]);
});

it.each(["42501", "57014", "PGRST301"])("does not conceal permissions, timeout or credential failures (%s)", async (code) => {
	m.responses = [{ error: { code, message: "campaigns.public_slug unavailable" } }];
	await expect(listPublishedSessions()).rejects.toThrow("Published session unavailable");
	expect(m.calls).toHaveLength(1);
});

it("bounds Home to five rows in one query with deterministic campaign tie ordering", async () => {
	m.responses = [{ data: Array.from({length: 5}, (_,i) => ({...row, source_session_id: String(i)})), error: null }];
	expect(await listHomePublishedSessions()).toHaveLength(5);
	expect(m.calls).toHaveLength(1);
	expect(m.calls[0].filters).toContainEqual(["range", 0, 4]);
	expect(m.calls[0].filters).toContainEqual(["order", "campaigns(public_slug)", { ascending: true }]);
	expect(String(m.calls[0].filters)).not.toContain("summary_full");
});

it("resolves legacy source IDs within the historical campaign without reading the archive", async () => {
	m.responses = [{data: row, error: null}];
	expect(await findLegacyPublishedSession("shared")).toMatchObject({ id: "shared", campaignSlug: "cronicas-da-mesa" });
	expect(m.calls).toHaveLength(1);
	expect(m.calls[0].filters).toContainEqual(["eq", "campaigns.public_slug", "cronicas-da-mesa"]);
	expect(m.calls[0].filters).toContainEqual(["eq", "source_session_id", "shared"]);
});

it.each(["2026-10-01", ""])("bounds both adjacent reads and preserves campaign/public filters for date %s", async (date) => {
	m.responses = [{data: [], error: null}, {data: [], error: null}];
	await expect(findAdjacentPublishedSessions({...toPublishedSession(row)!, date})).resolves.toEqual({previous: undefined, next: undefined});
	expect(m.calls).toHaveLength(2);
	for (const call of m.calls) {
		expect(call.filters).toContainEqual(["limit", 1]);
		expect(call.filters).toContainEqual(["eq", "campaigns.public_slug", "cronicas-da-mesa"]);
		expect(call.filters).toContainEqual(["eq", "status", "published"]);
		expect(call.filters).toContainEqual(["eq", "campaigns.visibility", "public"]);
	}
});
