import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	compareHomeSessions,
	HOME_SESSION_FEED_LIMIT,
} from "./home-feed";
import {
	toPublishedSession,
	type PublishedSession,
} from "./model";

const mocks = vi.hoisted(() => ({
	publishedDataClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({
	publishedDataClient: mocks.publishedDataClient,
}));

import {
	findPublishedSessionNeighbors,
	listHomePublishedSessions,
} from "./repository";

type SyntheticRow = {
	id: string;
	source_session_id: string;
	title: string;
	session_date: string | null;
	arc: string;
	summary_short: string;
	cover_image_url?: string;
	hero_image_url?: string;
	status: "published";
	campaigns: {
		id: string;
		name: string;
		slug: string;
		public_slug: string;
		lifecycle: "active";
		visibility: "public";
	};
};

type Filter =
	| { kind: "eq" | "gt" | "lt"; column: string; value: unknown }
	| { kind: "is"; column: string; value: unknown }
	| { kind: "not"; column: string; operator: string; value: unknown };

type Order = {
	column: string;
	ascending: boolean;
	nullsFirst: boolean;
};

type QueryReceipt = {
	selectedColumns?: string;
	filters: Filter[];
	orders: Order[];
	limit?: number;
	range?: readonly [number, number];
	transferred: number;
};

type FakeResult = {
	data: SyntheticRow[] | null;
	error: { code?: string; message?: string } | null;
};

function field(row: SyntheticRow, column: string): unknown {
	if (column === "campaigns(public_slug)") {
		return row.campaigns.public_slug;
	}
	if (column.startsWith("campaigns.")) {
		const key = column.slice("campaigns.".length) as keyof SyntheticRow["campaigns"];
		return row.campaigns[key];
	}
	return row[column as keyof SyntheticRow];
}

function compareValues(
	a: unknown,
	b: unknown,
	order: Order,
): number {
	const aNull = a === null || a === undefined;
	const bNull = b === null || b === undefined;
	if (aNull || bNull) {
		if (aNull && bNull) return 0;
		const nullResult = order.nullsFirst ? -1 : 1;
		return aNull ? nullResult : -nullResult;
	}
	const aText = String(a);
	const bText = String(b);
	const result = aText < bText ? -1 : aText > bText ? 1 : 0;
	return order.ascending ? result : -result;
}

function matchesFilter(row: SyntheticRow, filter: Filter) {
	const value = field(row, filter.column);
	if (filter.kind === "eq") return value === filter.value;
	if (filter.kind === "gt") {
		return value !== null && value !== undefined && String(value) > String(filter.value);
	}
	if (filter.kind === "lt") {
		return value !== null && value !== undefined && String(value) < String(filter.value);
	}
	if (filter.kind === "is") return value === filter.value;
	if (filter.kind === "not") {
		if (filter.operator === "is" && filter.value === null) {
			return value !== null && value !== undefined;
		}
		throw new Error(`Unsupported synthetic filter: ${filter.operator}`);
	}
	throw new Error("Unsupported synthetic filter kind");
}

class FakeQuery {
	private readonly receipt: QueryReceipt;
	private selectedColumns = "";

	constructor(
		private readonly rows: readonly SyntheticRow[],
		receipt: QueryReceipt,
		private readonly campaignRegistryGap = false,
	) {
		this.receipt = receipt;
	}

	select(columns: string) {
		this.selectedColumns = columns;
		this.receipt.selectedColumns = columns;
		return this;
	}

	eq(column: string, value: unknown) {
		this.receipt.filters.push({ kind: "eq", column, value });
		return this;
	}

	gt(column: string, value: unknown) {
		this.receipt.filters.push({ kind: "gt", column, value });
		return this;
	}

	lt(column: string, value: unknown) {
		this.receipt.filters.push({ kind: "lt", column, value });
		return this;
	}

	is(column: string, value: unknown) {
		this.receipt.filters.push({ kind: "is", column, value });
		return this;
	}

	not(column: string, operator: string, value: unknown) {
		this.receipt.filters.push({
			kind: "not",
			column,
			operator,
			value,
		});
		return this;
	}

	order(
		column: string,
		options: { ascending?: boolean; nullsFirst?: boolean } = {},
	) {
		this.receipt.orders.push({
			column,
			ascending: options.ascending ?? true,
			nullsFirst: options.nullsFirst ?? false,
		});
		return this;
	}

	limit(rows: number) {
		this.receipt.limit = rows;
		return Promise.resolve(this.execute());
	}

	range(from: number, to: number) {
		this.receipt.range = [from, to];
		return Promise.resolve(this.execute());
	}

	private execute(): FakeResult {
		if (
			this.campaignRegistryGap &&
			this.selectedColumns.includes("public_slug")
		) {
			return {
				data: null,
				error: {
					code: "PGRST204",
					message: "campaigns.public_slug is not present in the schema cache",
				},
			};
		}

		let result = this.rows.filter((row) =>
			this.receipt.filters.every((filter) => matchesFilter(row, filter)),
		);

		result = [...result].sort((a, b) => {
			for (const order of this.receipt.orders) {
				const compared = compareValues(
					field(a, order.column),
					field(b, order.column),
					order,
				);
				if (compared !== 0) return compared;
			}
			return 0;
		});

		if (this.receipt.range) {
			const [from, to] = this.receipt.range;
			result = result.slice(from, to + 1);
		}
		if (this.receipt.limit !== undefined) {
			result = result.slice(0, this.receipt.limit);
		}
		this.receipt.transferred = result.length;
		return { data: result, error: null };
	}

}

class FakeClient {
	readonly calls: QueryReceipt[] = [];

	constructor(
		private readonly rows: readonly SyntheticRow[],
		private readonly campaignRegistryGap = false,
	) {}

	from(table: string) {
		expect(table).toBe("sessions");
		const receipt: QueryReceipt = {
			filters: [],
			orders: [],
			transferred: 0,
		};
		this.calls.push(receipt);
		return new FakeQuery(this.rows, receipt, this.campaignRegistryGap);
	}
}

function row(
	internalId: string,
	sourceId: string,
	date: string | null,
	campaignSlug = "campaign-a",
): SyntheticRow {
	return {
		id: internalId,
		source_session_id: sourceId,
		title: `Sessão ${campaignSlug} ${sourceId}`,
		session_date: date,
		arc: "Arco sintético",
		summary_short: "Resumo público sintético",
		status: "published",
		campaigns: {
			id: `id-${campaignSlug}`,
			name: `Campaign ${campaignSlug}`,
			slug: `technical-${campaignSlug}`,
			public_slug: campaignSlug,
			lifecycle: "active",
			visibility: "public",
		},
	};
}

function published(rowValue: SyntheticRow): PublishedSession {
	const value = toPublishedSession(rowValue);
	if (!value) throw new Error("Synthetic row did not map to a published session");
	return value;
}

function requiredRow(rows: readonly SyntheticRow[], index: number): SyntheticRow {
	const value = rows[index];
	if (!value) throw new Error(`Synthetic row ${index} is missing`);
	return value;
}

function homeRows(total: number) {
	const rows: SyntheticRow[] = [
		row("internal-a-shared", "shared", "2030-01-01", "campaign-a"),
		row("internal-b-shared", "shared", "2030-01-01", "campaign-b"),
		row("internal-a-alpha", "alpha", "2030-01-01", "campaign-a"),
	];

	for (let index = rows.length; index < total; index += 1) {
		const date = new Date(
			Date.UTC(2029, 11, 31) - (index - rows.length) * 86_400_000,
		)
			.toISOString()
			.slice(0, 10);
		rows.push(
			row(
				`internal-${index}`,
				`source-${String(index).padStart(4, "0")}`,
				date,
				index % 2 === 0 ? "campaign-a" : "campaign-b",
			),
		);
	}

	return rows;
}

function transferred(client: FakeClient) {
	return client.calls.reduce((sum, call) => sum + call.transferred, 0);
}

describe("bounded published-session reads", () => {
	beforeEach(() => {
		mocks.publishedDataClient.mockReset();
		delete process.env.TDA_E2E_FIXTURES;
	});

	it.each([13, 200, 1000])(
		"Home reads one bounded page for %i available sessions",
		async (total) => {
			const rows = homeRows(total);
			const client = new FakeClient(rows);
			mocks.publishedDataClient.mockReturnValue(client);

			const sessions = await listHomePublishedSessions();
			const expected = rows
				.map(published)
				.sort(compareHomeSessions)
				.slice(0, HOME_SESSION_FEED_LIMIT);

			expect(
				sessions?.map(
					(session) => `${session.campaignSlug}:${session.id}`,
				),
			).toEqual(
				expected.map(
					(session) => `${session.campaignSlug}:${session.id}`,
				),
			);
			expect(client.calls).toHaveLength(1);
			expect(client.calls[0]?.limit).toBe(HOME_SESSION_FEED_LIMIT);
			expect(client.calls[0]?.selectedColumns).toContain("summary_short");
			expect(client.calls[0]?.selectedColumns).toContain("cover_image_url");
			expect(client.calls[0]?.selectedColumns).toContain("hero_image_url");
			expect(transferred(client)).toBe(HOME_SESSION_FEED_LIMIT);
			expect(
				client.calls[0]?.orders.map((order) => order.column),
			).toEqual([
				"session_date",
				"campaigns(public_slug)",
				"source_session_id",
				"id",
			]);
		},
	);

	it("keeps the legacy campaign-registry fallback bounded", async () => {
		const rows = homeRows(13).map((item) => ({
			...item,
			campaigns: {
				...item.campaigns,
				slug: "yuhara-main",
			},
		}));
		const client = new FakeClient(rows, true);
		mocks.publishedDataClient.mockReturnValue(client);

		const sessions = await listHomePublishedSessions();

		expect(sessions).toHaveLength(HOME_SESSION_FEED_LIMIT);
		expect(client.calls).toHaveLength(2);
		expect(client.calls[0]?.transferred).toBe(0);
		expect(client.calls[1]?.limit).toBe(HOME_SESSION_FEED_LIMIT);
		expect(transferred(client)).toBe(HOME_SESSION_FEED_LIMIT);
	});

	it("preserves the public card payload while bounding the Home read", async () => {
		const rows = homeRows(13);
		rows[0] = {
			...requiredRow(rows, 0),
			title: "Título editorial preservado",
			arc: "Arco preservado",
			summary_short: "Resumo editorial preservado sem truncamento adicional.",
			cover_image_url:
				"https://media.dnd.faysk.dev/campaigns/technical-campaign-a/sessions/shared/cover.webp",
			hero_image_url:
				"https://media.dnd.faysk.dev/campaigns/technical-campaign-a/sessions/shared/hero.webp",
		};

		const client = new FakeClient(rows);
		mocks.publishedDataClient.mockReturnValue(client);

		const sessions = await listHomePublishedSessions();
		const item = sessions?.find(
			(session) =>
				session.campaignSlug === "campaign-a" && session.id === "shared",
		);

		expect(item).toMatchObject({
			title: "Título editorial preservado",
			arc: "Arco preservado",
			summary: "Resumo editorial preservado sem truncamento adicional.",
			coverImage:
				"https://media.dnd.faysk.dev/campaigns/technical-campaign-a/sessions/shared/cover.webp",
			heroImage:
				"https://media.dnd.faysk.dev/campaigns/technical-campaign-a/sessions/shared/hero.webp",
		});
		expect(client.calls).toHaveLength(1);
		expect(transferred(client)).toBe(HOME_SESSION_FEED_LIMIT);
	});

	it("keeps same source IDs distinct across campaigns in the bounded Home result", async () => {
		const client = new FakeClient(homeRows(13));
		mocks.publishedDataClient.mockReturnValue(client);

		const sessions = await listHomePublishedSessions();
		const shared = sessions?.filter((session) => session.id === "shared");

		expect(shared?.map((session) => session.campaignSlug)).toEqual([
			"campaign-a",
			"campaign-b",
		]);
	});

	it("resolves same-date neighbors with two one-row reads and never crosses campaigns", async () => {
		const rows = [
			row("a-1", "alpha", "2026-09-30"),
			row("a-2", "bravo", "2026-09-30"),
			row("a-3", "charlie", "2026-09-30"),
			row("a-4", "delta", "2026-09-29"),
			row("a-5", "echo", null),
			row("a-6", "foxtrot", null),
			row("b-1", "bravo", "2026-10-01", "campaign-b"),
		];
		const client = new FakeClient(rows);
		mocks.publishedDataClient.mockReturnValue(client);

		const neighbors = await findPublishedSessionNeighbors(published(requiredRow(rows, 1)));

		expect(neighbors.previous).toMatchObject({
			campaignSlug: "campaign-a",
			id: "charlie",
		});
		expect(neighbors.next).toMatchObject({
			campaignSlug: "campaign-a",
			id: "alpha",
		});
		expect(client.calls).toHaveLength(2);
		expect(client.calls.every((call) => call.limit === 1)).toBe(true);
		expect(
			client.calls.every(
				(call) =>
					call.selectedColumns?.includes("title") &&
					call.selectedColumns.includes("arc") &&
					call.selectedColumns.includes("cover_image_url") &&
					!call.selectedColumns.includes("summary_short") &&
					!call.selectedColumns.includes("session_date"),
			),
		).toBe(true);
		expect(transferred(client)).toBe(2);
	});

	it("walks date and null boundaries without loading the campaign archive", async () => {
		const rows = [
			row("a-1", "alpha", "2026-09-30"),
			row("a-2", "bravo", "2026-09-30"),
			row("a-3", "charlie", "2026-09-30"),
			row("a-4", "delta", "2026-09-29"),
			row("a-5", "echo", null),
			row("a-6", "foxtrot", null),
		];
		const client = new FakeClient(rows);
		mocks.publishedDataClient.mockReturnValue(client);

		const neighbors = await findPublishedSessionNeighbors(published(requiredRow(rows, 3)));

		expect(neighbors.previous?.id).toBe("echo");
		expect(neighbors.next?.id).toBe("charlie");
		expect(client.calls).toHaveLength(5);
		expect(client.calls.every((call) => call.limit === 1)).toBe(true);
		expect(transferred(client)).toBe(2);
	});

	it("keeps archive edges empty without widening the neighbor read", async () => {
		const rows = [
			row("a-1", "alpha", "2026-09-30"),
			row("a-2", "delta", "2026-09-29"),
			row("a-3", "echo", null),
		];

		const newestClient = new FakeClient(rows);
		mocks.publishedDataClient.mockReturnValue(newestClient);
		const newest = await findPublishedSessionNeighbors(published(requiredRow(rows, 0)));

		expect(newest.previous?.id).toBe("delta");
		expect(newest.next).toBeUndefined();
		expect(newestClient.calls.every((call) => call.limit === 1)).toBe(true);
		expect(transferred(newestClient)).toBe(1);

		const oldestClient = new FakeClient(rows);
		mocks.publishedDataClient.mockReturnValue(oldestClient);
		const oldest = await findPublishedSessionNeighbors(published(requiredRow(rows, 2)));

		expect(oldest.previous).toBeUndefined();
		expect(oldest.next?.id).toBe("delta");
		expect(oldestClient.calls.every((call) => call.limit === 1)).toBe(true);
		expect(transferred(oldestClient)).toBe(1);
	});

	it("keeps missing-date neighbors in archive order with bounded probes", async () => {
		const rows = [
			row("a-1", "alpha", "2026-09-30"),
			row("a-2", "delta", "2026-09-29"),
			row("a-3", "echo", null),
			row("a-4", "foxtrot", null),
		];
		const client = new FakeClient(rows);
		mocks.publishedDataClient.mockReturnValue(client);

		const neighbors = await findPublishedSessionNeighbors(published(requiredRow(rows, 2)));

		expect(neighbors.previous?.id).toBe("foxtrot");
		expect(neighbors.next?.id).toBe("delta");
		expect(client.calls).toHaveLength(3);
		expect(client.calls.every((call) => call.limit === 1)).toBe(true);
		expect(transferred(client)).toBe(2);
	});
});
