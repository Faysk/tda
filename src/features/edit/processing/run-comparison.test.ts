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
		const regions = compareRunSegments(
			[segment(1, "a", 0, 2, "Olá   mundo")],
			[segment(1, "b", 0.02, 2.01, "Olá mundo")],
		);
		expect(regions).toHaveLength(1);
		expect(regions[0]).toMatchObject({
			trackNumber: 1,
			kind: "equal",
			speakerChanged: false,
		});
	});

	it("groups one-to-many segmentation only within the longer anchor", () => {
		const regions = compareRunSegments(
			[segment(1, "a", 0, 3, "Bom dia a todos")],
			[
				segment(1, "b1", 0, 0.9, "Bom"),
				segment(1, "b2", 0.9, 1.8, "dia"),
				segment(1, "b3", 1.8, 3, "a todos"),
			],
		);
		expect(regions).toHaveLength(1);
		expect(regions[0]?.kind).toBe("equal");
		expect(regions[0]?.right).toHaveLength(3);
	});

	it("does not transitively collapse consecutive equal utterances", () => {
		const left = Array.from({ length: 100 }, (_, index) =>
			segment(1, `l-${index}`, index, index + 1, `fala ${index}`),
		);
		const right = Array.from({ length: 100 }, (_, index) =>
			segment(1, `r-${index}`, index, index + 1, `fala ${index}`),
		);
		const regions = compareRunSegments(left, right);
		expect(regions).toHaveLength(100);
		expect(regions.every((region) => region.kind === "equal")).toBe(true);
	});

	it("keeps touching adjacent utterances separate", () => {
		const regions = compareRunSegments(
			[
				segment(1, "l1", 0, 1, "um"),
				segment(1, "l2", 1, 2, "dois"),
			],
			[
				segment(1, "r1", 0, 1, "um"),
				segment(1, "r2", 1, 2, "dois"),
			],
			{ timeToleranceSeconds: 0 },
		);
		expect(regions).toHaveLength(2);
	});

	it("uses member identity instead of rounded timestamps for region keys", () => {
		const regions = compareRunSegments(
			[
				segment(1, "left:a", 0, 1, "A"),
				segment(1, 'left:"b"', 0, 1, "B"),
			],
			[],
		);
		expect(regions).toHaveLength(2);
		expect(new Set(regions.map((region) => region.id)).size).toBe(2);
	});

	it("keeps region keys deterministic across input permutations", () => {
		const left = [
			segment(1, "b", 0, 3, "Bom dia"),
			segment(1, "a", 0, 3, "Bom dia"),
		];
		const right = [segment(1, "r", 0, 3, "Bom dia Bom dia")];
		const first = compareRunSegments(left, right).map((region) => region.id);
		const second = compareRunSegments([...left].reverse(), right).map(
			(region) => region.id,
		);
		expect(second).toEqual(first);
	});

	it("does not use compatibility Unicode normalization to erase text differences", () => {
		const regions = compareRunSegments(
			[segment(1, "left", 0, 1, "①")],
			[segment(1, "right", 0, 1, "1")],
		);
		expect(regions[0]?.kind).toBe("changed");
	});

	it("detects speaker attribution order instead of unordered speaker sets", () => {
		const regions = compareRunSegments(
			[
				segment(1, "l1", 0, 2, "a", "Alice"),
				segment(1, "l2", 0.5, 1.5, "b", "Bob"),
			],
			[
				segment(1, "r1", 0, 2, "a", "Bob"),
				segment(1, "r2", 0.5, 1.5, "b", "Alice"),
			],
		);
		expect(regions.some((region) => region.speakerChanged)).toBe(true);
	});

	it("counts speaker-only differences as different regions", () => {
		const regions = compareRunSegments(
			[segment(1, "left", 0, 1, "mesmo", "Alice")],
			[segment(1, "right", 0, 1, "mesmo", "Bob")],
		);
		expect(summarizeRunComparison(regions)).toMatchObject({
			equalRegions: 1,
			speakerChangedRegions: 1,
			differentRegions: 1,
		});
	});

	it("reports changed, missing and extra timed regions without crossing tracks", () => {
		const regions = compareRunSegments(
			[
				segment(1, "l1", 0, 1, "Neverwinter"),
				segment(1, "l2", 5, 6, "Somente esquerda"),
				segment(2, "l3", 1, 2, "Track dois", "Bob"),
			],
			[
				segment(1, "r1", 0.02, 1.02, "Never winter"),
				segment(1, "r2", 9, 10, "Somente direita"),
				segment(2, "r3", 1.02, 2.02, "Track dois", "Bob"),
			],
		);
		expect(regions.map((item) => item.kind)).toEqual([
			"changed",
			"left_only",
			"right_only",
			"equal",
		]);
		expect(summarizeRunComparison(regions)).toMatchObject({
			totalRegions: 4,
			differentRegions: 3,
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
	});

	it("rejects an invalid alignment tolerance", () => {
		expect(() =>
			compareRunSegments([], [], { timeToleranceSeconds: 30 }),
		).toThrow("RUN_COMPARISON_TOLERANCE_INVALID");
	});
});
