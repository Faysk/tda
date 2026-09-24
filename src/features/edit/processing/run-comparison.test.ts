import { describe, expect, it } from "vitest";
import type { LocalReviewSegment } from "./protocol";
import {
	compareRunSegments,
	runsShareComparisonSource,
	summarizeRunComparison,
} from "./run-comparison";

function segment(
	trackNumber: number,
	segmentId: string,
	start: number,
	end: number,
	text: string,
	speaker = "Alice",
): LocalReviewSegment {
	return {
		trackNumber,
		segmentId,
		start,
		end,
		text,
		speaker,
		reviewed: false,
	};
}

describe("run comparison", () => {
	it("keeps identical aligned text equal", () => {
		const left = [segment(1, "a", 0, 2, "Olá   mundo")];
		const right = [segment(1, "b", 0.02, 2.01, "Olá mundo")];

		const regions = compareRunSegments(left, right);

		expect(regions).toHaveLength(1);
		expect(regions[0]).toMatchObject({
			trackNumber: 1,
			kind: "equal",
			leftText: "Olá   mundo",
			rightText: "Olá mundo",
			speakerChanged: false,
		});
	});

	it("does not create false differences when one engine splits an aligned phrase", () => {
		const left = [segment(1, "a", 0, 3, "Bom dia a todos")];
		const right = [
			segment(1, "b1", 0, 0.9, "Bom"),
			segment(1, "b2", 0.9, 1.8, "dia"),
			segment(1, "b3", 1.8, 3, "a todos"),
		];

		const regions = compareRunSegments(left, right);

		expect(regions).toHaveLength(1);
		expect(regions[0]?.kind).toBe("equal");
		expect(regions[0]?.right).toHaveLength(3);
	});

	it("reports changed, missing and extra timed regions without crossing tracks", () => {
		const left = [
			segment(1, "l1", 0, 1, "Neverwinter"),
			segment(1, "l2", 5, 6, "Somente esquerda"),
			segment(2, "l3", 1, 2, "Track dois", "Bob"),
		];
		const right = [
			segment(1, "r1", 0.02, 1.02, "Never winter"),
			segment(1, "r2", 9, 10, "Somente direita"),
			segment(2, "r3", 1.02, 2.02, "Track dois", "Bob"),
		];

		const regions = compareRunSegments(left, right);
		const summary = summarizeRunComparison(regions);

		expect(regions.map((item) => item.kind)).toEqual([
			"changed",
			"left_only",
			"right_only",
			"equal",
		]);
		expect(summary).toEqual({
			totalRegions: 4,
			equalRegions: 1,
			changedRegions: 1,
			leftOnlyRegions: 1,
			rightOnlyRegions: 1,
			differentRegions: 3,
		});
	});

	it("keeps same text far apart in time as separate regions", () => {
		const regions = compareRunSegments(
			[segment(1, "left", 0, 1, "igual")],
			[segment(1, "right", 10, 11, "igual")],
		);

		expect(regions.map((item) => item.kind)).toEqual([
			"left_only",
			"right_only",
		]);
	});

	it("surfaces speaker changes independently from text changes", () => {
		const regions = compareRunSegments(
			[segment(1, "left", 0, 1, "mesmo texto", "Alice")],
			[segment(1, "right", 0, 1, "mesmo texto", "Alicia")],
		);

		expect(regions[0]).toMatchObject({
			kind: "equal",
			speakerChanged: true,
		});
	});

	it("requires two distinct runs from the same source", () => {
		expect(
			runsShareComparisonSource(
				{ sourceId: "craig-a", runId: "run-a" },
				{ sourceId: "craig-a", runId: "run-b" },
			),
		).toBe(true);
		expect(
			runsShareComparisonSource(
				{ sourceId: "craig-a", runId: "run-a" },
				{ sourceId: "craig-b", runId: "run-b" },
			),
		).toBe(false);
		expect(
			runsShareComparisonSource(
				{ sourceId: "craig-a", runId: "run-a" },
				{ sourceId: "craig-a", runId: "run-a" },
			),
		).toBe(false);
	});

	it("rejects an unbounded alignment tolerance", () => {
		expect(() =>
			compareRunSegments([], [], { timeToleranceSeconds: 30 }),
		).toThrow("RUN_COMPARISON_TOLERANCE_INVALID");
	});
});
