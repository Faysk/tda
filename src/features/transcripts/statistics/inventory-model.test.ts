import { describe, expect, it } from "vitest";
import type { SessionMetric } from "./model";
import {
	filterAndSortSessions,
	sessionHasCompleteCoverage,
} from "./inventory-model";

function metric(
	id: string,
	overrides: Partial<SessionMetric> = {},
): SessionMetric {
	return {
		id,
		title: \`Sessão \${id}\`,
		date: "2026-09-01",
		words: 100,
		durationMs: 60_000,
		...overrides,
	};
}

describe("transcript inventory model", () => {
	it("matches title search without requiring accents", () => {
		const sessions = [
			metric("1", { title: "O reencontro à beira do rio" }),
			metric("2", { title: "A travessia das montanhas" }),
		];

		expect(
			filterAndSortSessions(
				sessions,
				"reencontro a beira",
				"all",
				"date-desc",
			).map((session) => session.id),
		).toEqual(["1"]);
	});

	it("keeps incomplete coverage distinct from zero values", () => {
		const sessions = [
			metric("complete-zero", { words: 0, durationMs: 0 }),
			metric("missing-words", { words: null }),
			metric("missing-duration", { durationMs: null }),
		];

		expect(sessionHasCompleteCoverage(sessions[0])).toBe(true);
		expect(
			filterAndSortSessions(
				sessions,
				"",
				"incomplete",
				"title-asc",
			).map((session) => session.id),
		).toEqual(["missing-duration", "missing-words"]);
	});

	it("sorts nullable numeric values with missing data last", () => {
		const sessions = [
			metric("middle", { words: 200 }),
			metric("missing", { words: null }),
			metric("largest", { words: 900 }),
			metric("smallest", { words: 10 }),
		];

		expect(
			filterAndSortSessions(sessions, "", "all", "words-desc").map(
				(session) => session.id,
			),
		).toEqual(["largest", "middle", "smallest", "missing"]);
		expect(
			filterAndSortSessions(sessions, "", "all", "words-asc").map(
				(session) => session.id,
			),
		).toEqual(["smallest", "middle", "largest", "missing"]);
	});

	it("preserves input order when sort values are equal", () => {
		const sessions = [
			metric("first", { words: 100 }),
			metric("second", { words: 100 }),
			metric("third", { words: 100 }),
		];

		expect(
			filterAndSortSessions(sessions, "", "all", "words-desc").map(
				(session) => session.id,
			),
		).toEqual(["first", "second", "third"]);
	});

	it("handles a 250-session inventory without truncation", () => {
		const sessions = Array.from({ length: 250 }, (_, index) =>
			metric(String(index), {
				title: \`Sessão \${String(index).padStart(3, "0")}\`,
			}),
		);

		expect(
			filterAndSortSessions(sessions, "", "all", "title-asc"),
		).toHaveLength(250);
	});
});
