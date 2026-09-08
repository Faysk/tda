import { describe, expect, it } from "vitest";
import {
	formatArchiveDuration,
	formatArchiveNumber,
	parseArchiveMetric,
	summarizeSessionArchive,
	type SessionArchiveItem,
} from "./archive";

function session(
	id: string,
	metrics: Pick<
		SessionArchiveItem,
		"durationMs" | "wordCount" | "participantCount"
	>,
): SessionArchiveItem {
	return {
		id,
		title: id,
		date: "2026-09-01",
		arc: "Arco",
		summary: "Resumo",
		...metrics,
	};
}

describe("public session archive metrics", () => {
	it("parses only finite non-negative safe integers", () => {
		expect(parseArchiveMetric(12)).toBe(12);
		expect(parseArchiveMetric("237073")).toBe(237073);
		expect(parseArchiveMetric(-1)).toBeNull();
		expect(parseArchiveMetric(1.2)).toBeNull();
		expect(parseArchiveMetric("12.2")).toBeNull();
		expect(parseArchiveMetric(null)).toBeNull();
	});

	it("formats duration and counts for the public archive", () => {
		expect(formatArchiveDuration(null)).toBe("—");
		expect(formatArchiveDuration(0)).toBe("0 min");
		expect(formatArchiveDuration(30_000)).toBe("< 1 min");
		expect(formatArchiveDuration(12_780_000)).toBe("3 h 33 min");
		expect(formatArchiveNumber(237073)).toBe("237.073");
	});

	it("sums known values without pretending missing coverage is zero", () => {
		const result = summarizeSessionArchive([
			session("one", {
				durationMs: 7_200_000,
				wordCount: 20_000,
				participantCount: 4,
			}),
			session("two", {
				durationMs: null,
				wordCount: 15_000,
				participantCount: null,
			}),
		]);

		expect(result).toEqual({
			sessions: 2,
			durationMs: 7_200_000,
			durationCoverage: 1,
			wordCount: 35_000,
			wordCoverage: 2,
			participantCount: 4,
			participantCoverage: 1,
		});
	});
});
