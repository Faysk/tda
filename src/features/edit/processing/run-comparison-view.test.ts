import { describe, expect, it } from "vitest";
import type { LocalReviewSegment } from "./protocol";
import { compareRunSegments } from "./run-comparison";
import {
	comparisonRegionView,
	filterComparisonRegions,
} from "./run-comparison-view";

function segment(
	trackNumber: number,
	segmentId: string,
	start: number,
	end: number,
	text: string,
	speaker: string,
	timelineOffset = 0,
): LocalReviewSegment {
	return {
		trackNumber,
		segmentId,
		start,
		end,
		timelineStart: start + timelineOffset,
		timelineEnd: end + timelineOffset,
		text,
		speaker,
		reviewed: false,
	};
}

describe("run comparison view", () => {
	it("orders navigation by global session coordinates while matching stays track-local", () => {
		const regions = compareRunSegments(
			[
				segment(1, "l-late", 0, 1, "late", "Alice", 20),
				segment(2, "l-early", 0, 1, "early", "Bob", 3),
			],
			[
				segment(1, "r-late", 0, 1, "late changed", "Alice", 20),
				segment(2, "r-early", 0, 1, "early changed", "Bob", 3),
			],
		);
		const ordered = filterComparisonRegions(regions, {
			onlyDifferences: true,
			speaker: null,
			startSeconds: null,
			endSeconds: null,
		});
		expect(ordered.map((item) => item.region.trackNumber)).toEqual([2, 1]);
		expect(ordered.map((item) => item.sessionStart)).toEqual([3, 20]);
	});

	it("treats speaker-only changes as differences", () => {
		const [region] = compareRunSegments(
			[segment(1, "left", 0, 1, "igual", "Alice")],
			[segment(1, "right", 0, 1, "igual", "Bob")],
		);
		if (!region) throw new Error("missing region");
		expect(comparisonRegionView(region).isDifferent).toBe(true);
		expect(
			filterComparisonRegions([region], {
				onlyDifferences: true,
				speaker: "Bob",
				startSeconds: 0,
				endSeconds: 1,
			}),
		).toHaveLength(1);
	});

	it("applies participant and global time-range filters without changing region identity", () => {
		const regions = compareRunSegments(
			[
				segment(1, "a", 0, 1, "A", "Alice", 10),
				segment(2, "b", 0, 1, "B", "Bob", 30),
			],
			[
				segment(1, "ra", 0, 1, "AA", "Alice", 10),
				segment(2, "rb", 0, 1, "BB", "Bob", 30),
			],
		);
		const filtered = filterComparisonRegions(regions, {
			onlyDifferences: false,
			speaker: "Bob",
			startSeconds: 25,
			endSeconds: 35,
		});
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.region.trackNumber).toBe(2);
		expect(
			filterComparisonRegions(regions, {
				onlyDifferences: false,
				speaker: null,
				startSeconds: 40,
				endSeconds: 20,
			}),
		).toEqual([]);
	});
});
