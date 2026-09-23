import { describe, expect, it, vi } from "vitest";
import {
	collectStatistics,
	type SessionAggregateRow,
	type SessionRow,
} from "./read";
import {
	formatDuration,
	recordedDuration,
	segmentWords,
	summarize,
} from "./model";

const session = (
	id: string,
	duration_ms: number | null = null,
): SessionRow => ({
	id,
	title: "Sessão sintética",
	session_date: null,
	duration_ms,
});

const aggregate = (
	session_id: string,
	segment_count: number,
	complete_text_count: number,
	word_count: number,
): SessionAggregateRow => ({
	session_id,
	segment_count,
	complete_text_count,
	word_count,
});

const page = <T extends { id: string }>(
	rows: T[],
	after: string | null,
	limit = 2,
) => rows.filter((row) => !after || row.id > after).slice(0, limit);

describe("transcript metric definitions", () => {
	it.each([
		["", 0],
		[" \n\t", 0],
		["Olá, ação!", 2],
		["d'água guarda-chuva", 2],
		["um\u00a0dois\ntrês", 3],
		["... —", 2],
		[null, null],
	])(
		"counts whitespace tokens consistently with Edit: %s",
		(text, expected) => {
			expect(segmentWords(text)).toBe(expected);
		},
	);
	it.each([null, undefined, -1, NaN, Infinity, "60000", 0.5])(
		"does not invent duration for %s",
		(value) => expect(recordedDuration(value)).toBeNull(),
	);
	it("formats milliseconds without rounding each session into the total", () => {
		expect(formatDuration(null)).toBe("Não informada");
		expect(formatDuration(0)).toBe("0 min");
		expect(formatDuration(30_000)).toBe("Menos de 1 min");
		expect(formatDuration(3_660_000)).toBe("1 h 1 min");
		const totals = summarize(
			[1, 2].map((id) => ({
				id: String(id),
				title: "",
				date: null,
				words: 0,
				durationMs: 30_000,
			})),
		);
		expect(formatDuration(totals.durationMs)).toBe("1 min");
	});
});

describe("bounded authorized statistics collector", () => {
	it("reads one aggregate batch per session page and never depends on segment volume", async () => {
		const sessions = Array.from({ length: 205 }, (_, i) =>
			session(String(i).padStart(4, "0"), 60_000),
		);
		const reads = vi.fn(async (_campaign: string, ids: readonly string[]) =>
			ids.map((id) => aggregate(id, 10_000, 10_000, 20_000)),
		);
		const result = await collectStatistics("a", {
			sessions: async (_, after) => page(sessions, after, 100),
			aggregates: reads,
		});

		expect(reads).toHaveBeenCalledTimes(3);
		expect(reads.mock.calls.map((call) => call[1].length)).toEqual([
			100, 100, 5,
		]);
		expect(result.totals).toEqual({
			sessions: 205,
			words: 4_100_000,
			durationMs: 12_300_000,
			wordCoverage: 205,
			durationCoverage: 205,
		});
	});

	it("distinguishes no segments, incomplete text and explicit zero words", async () => {
		const result = await collectStatistics("a", {
			sessions: async (_, after) =>
				page([session("a", 0), session("b"), session("c", 60_000)], after),
			aggregates: async (_, ids) =>
				[
					aggregate("a", 1, 1, 0),
					aggregate("c", 2, 1, 7),
				].filter((row) => ids.includes(row.session_id)),
		});

		expect(result.sessions.map((row) => row.words)).toEqual([0, null, null]);
		expect(result.totals).toEqual({
			sessions: 3,
			words: 0,
			durationMs: 60_000,
			wordCoverage: 1,
			durationCoverage: 2,
		});
	});

	it("never derives duration from transcript aggregates", async () => {
		const result = await collectStatistics("a", {
			sessions: async (_, after) =>
				page([session("s", 600_000), session("t")], after),
			aggregates: async (_, ids) =>
				ids.includes("s") ? [aggregate("s", 500_000, 500_000, 1)] : [],
		});
		expect(result.totals.durationMs).toBe(600_000);
		expect(result.sessions[1].durationMs).toBeNull();
	});

	it("rejects cross-session, duplicate and structurally invalid aggregate rows", async () => {
		for (const rows of [
			[aggregate("other", 1, 1, 1)],
			[aggregate("s", 1, 1, 1), aggregate("s", 1, 1, 1)],
			[aggregate("s", 0, 0, 0)],
			[aggregate("s", 1, 2, 1)],
			[aggregate("s", 1, 1, -1)],
		]) {
			await expect(
				collectStatistics("a", {
					sessions: async (_, after) => page([session("s")], after),
					aggregates: async () => rows,
				}),
			).rejects.toThrow();
		}
	});

	it("fails closed on a failed aggregate page instead of returning partial totals", async () => {
		const sessions = [session("a"), session("b"), session("c")];
		const aggregates = vi
			.fn()
			.mockResolvedValueOnce([aggregate("a", 1, 1, 1), aggregate("b", 1, 1, 1)])
			.mockRejectedValue(new Error("offline"));

		await expect(
			collectStatistics("a", {
				sessions: async (_, after) => page(sessions, after, 2),
				aggregates,
			}),
		).rejects.toThrow("offline");
	});

	it("rejects a stuck or unsorted session cursor", async () => {
		await expect(
			collectStatistics("a", {
				sessions: async () => [session("s")],
				aggregates: async () => [],
			}),
		).rejects.toThrow("Non-progressing");

		await expect(
			collectStatistics("a", {
				sessions: async () => [session("b"), session("a")],
				aggregates: async () => [],
			}),
		).rejects.toThrow("Non-progressing");
	});
});
