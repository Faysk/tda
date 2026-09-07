import { describe, expect, it, vi } from "vitest";
import { collectStatistics, type SessionRow, type SegmentRow } from "./read";
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
const segment = (
	id: string,
	session_id: string,
	text: string | null,
): SegmentRow => ({ id, session_id, text, source_segment_id: id });
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

describe("complete authorized dataset collector", () => {
	it("includes sessions and segments beyond pages and never serializes transcript text", async () => {
		const sessions = Array.from({ length: 205 }, (_, i) =>
			session(String(i).padStart(4, "0"), 60_000),
		);
		const segments = Array.from({ length: 205 }, (_, i) =>
			segment(String(i).padStart(4, "0"), "0000", "SEGREDO sintético"),
		);
		const result = await collectStatistics("a", {
			sessions: async (_, after) => page(sessions, after, 100),
			segments: async (_, id, after) =>
				page(
					segments.filter((row) => row.session_id === id),
					after,
					100,
				),
		});
		expect(result.totals).toEqual({
			sessions: 205,
			words: 410,
			durationMs: 12_300_000,
			wordCoverage: 1,
			durationCoverage: 205,
		});
		expect(JSON.stringify(result)).not.toContain("SEGREDO");
	});
	it("separates empty text from missing transcript and missing duration", async () => {
		const result = await collectStatistics("a", {
			sessions: async (_, after) =>
				page([session("a", 0), session("b"), session("c", 60_000)], after),
			segments: async (_, id, after) =>
				page(
					id === "a"
						? [segment("a", id, "")]
						: id === "c"
							? [segment("a", id, null)]
							: [],
					after,
				),
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
	it("never sums overlapping tracks or uses end timestamps as duration", async () => {
		const overlapping = ["a", "b"].map((id) => ({
			...segment(id, "s", "sim"),
			start_ms: 0,
			end_ms: 600_000,
			duration: 600_000,
		}));
		const result = await collectStatistics("a", {
			sessions: async (_, after) =>
				page([session("s", 600_000), session("t")], after),
			segments: async (_, id, after) =>
				page(id === "s" ? overlapping : [], after),
		});
		expect(result.totals.durationMs).toBe(600_000);
		expect(result.sessions[1].durationMs).toBeNull();
	});
	it("rejects cross-session rows and duplicate alternate sources", async () => {
		for (const rows of [
			[segment("a", "other", "x")],
			[
				segment("a", "s", "x"),
				{ ...segment("b", "s", "alternative"), source_segment_id: "a" },
			],
		]) {
			await expect(
				collectStatistics("a", {
					sessions: async (_, after) => page([session("s")], after),
					segments: async (_, __, after) => page(rows, after),
				}),
			).rejects.toThrow();
		}
	});
	it("fails closed on a failed later page instead of returning partial totals", async () => {
		const segments = vi
			.fn()
			.mockResolvedValueOnce([segment("a", "s", "x")])
			.mockRejectedValue(new Error("offline"));
		await expect(
			collectStatistics("a", {
				sessions: async (_, after) => page([session("s")], after),
				segments,
			}),
		).rejects.toThrow("offline");
	});
	it("rejects a stuck cursor", async () => {
		await expect(
			collectStatistics("a", {
				sessions: async () => [session("s")],
				segments: async () => [],
			}),
		).rejects.toThrow("Non-progressing");
	});
});
