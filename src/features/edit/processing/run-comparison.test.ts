import { describe, expect, it } from "vitest";
import type { LocalReviewSegment, LocalRunSummary } from "./protocol";
import {
	compareRunPerformanceSemantics,
	compareRunSegments,
	regionOverlapsTimeRange,
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
		// Without explicit absolute session coordinates, preserve deterministic
		// track-local order instead of pretending track-local seconds are global.
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

	it("orders regions and filters by absolute session time across tracks", () => {
		const earlyLeft = {
			...segment(2, "early-left", 40, 41, "cedo"),
			timelineStart: 10,
			timelineEnd: 11,
		};
		const earlyRight = {
			...segment(2, "early-right", 40.02, 41.02, "cedo"),
			timelineStart: 10.02,
			timelineEnd: 11.02,
		};
		const lateLeft = {
			...segment(1, "late-left", 0, 1, "tarde"),
			timelineStart: 120,
			timelineEnd: 121,
		};
		const lateRight = {
			...segment(1, "late-right", 0.02, 1.02, "tarde"),
			timelineStart: 120.02,
			timelineEnd: 121.02,
		};
		const regions = compareRunSegments(
			[lateLeft, earlyLeft],
			[lateRight, earlyRight],
		);
		expect(regions.map((region) => region.trackNumber)).toEqual([2, 1]);
		expect(regions.map((region) => region.sessionStart)).toEqual([10, 120]);
		expect(regionOverlapsTimeRange(regions[0]!, 9, 12)).toBe(true);
		expect(regionOverlapsTimeRange(regions[1]!, 9, 12)).toBe(false);
	});

	it("filters aligned regions by an inclusive session time range", () => {
		const left = {
			...segment(1, "left", 10, 12, "janela"),
			timelineStart: 30,
			timelineEnd: 32,
		};
		const right = {
			...segment(1, "right", 10.1, 12.1, "janela"),
			timelineStart: 30.1,
			timelineEnd: 32.1,
		};
		const [region] = compareRunSegments([left], [right]);
		expect(region).toBeDefined();
		expect(regionOverlapsTimeRange(region!, 31, 40)).toBe(true);
		expect(regionOverlapsTimeRange(region!, 0, 29.9)).toBe(false);
		expect(regionOverlapsTimeRange(region!, 32.1, 32.1)).toBe(true);
	});

	it("fails closed for invalid time-range values", () => {
		const [region] = compareRunSegments(
			[segment(1, "left", 0, 1, "janela")],
			[segment(1, "right", 0, 1, "janela")],
		);
		expect(region).toBeDefined();
		expect(regionOverlapsTimeRange(region!, 2, 1)).toBe(false);
		expect(() => regionOverlapsTimeRange(region!, -1, null)).toThrow(
			"RUN_COMPARISON_TIME_RANGE_INVALID",
		);
	});

	it("orders regions globally by session timeline and filters on session time", () => {
		const leftTrackOne = {
			...segment(1, "track-1", 0, 1, "primeiro"),
			timelineStart: 20,
			timelineEnd: 21,
		};
		const leftTrackTwo = {
			...segment(2, "track-2", 0, 1, "segundo"),
			timelineStart: 5,
			timelineEnd: 6,
		};
		const regions = compareRunSegments([leftTrackOne, leftTrackTwo], []);

		expect(regions.map((region) => region.trackNumber)).toEqual([2, 1]);
		expect(regions.map((region) => [region.sessionStart, region.sessionEnd])).toEqual([
			[5, 6],
			[20, 21],
		]);
		expect(regionOverlapsTimeRange(regions[0]!, 4.5, 6)).toBe(true);
		expect(regionOverlapsTimeRange(regions[0]!, 10, 19)).toBe(false);
		expect(regionOverlapsTimeRange(regions[1]!, 20.5, 22)).toBe(true);
	});

	it("labels performance comparison as limited when runtime/device proof is absent", () => {
		const base = {
			stats: {
				audioWorkSeconds: 60,
				processingSeconds: 30,
				processingMetrics: null,
				sessionDurationSeconds: 60,
				durationSemantics: "session_extent_v1",
				rtf: 0.5,
				wordCount: 2,
				segmentCount: 1,
				trackCount: 1,
				turnCount: 1,
				deduplicatedSegmentCount: 0,
				warningCount: 0,
			},
			executionLineage: null,
		} as LocalRunSummary;
		const result = compareRunPerformanceSemantics(base, base);
		expect(result.status).toBe("limited");
		expect(result.reasons).toContain("medição engine_processing_v1 ausente");
		expect(result.reasons).toContain("identidade exata do runtime não foi registrada");
		expect(result.reasons).toContain("identidade física do dispositivo não foi comprovada");
	});

	it("allows factual performance comparability only for fresh work on the same proven device", () => {
		const run = {
			stats: {
				audioWorkSeconds: 60,
				processingSeconds: 30,
				processingMetrics: {
					version: "engine_processing_v1",
					stageSeconds: {
						runtime_validation: 1,
						checkpoint_scan: 1,
						model_prepare: 2,
						model_load: 2,
						transcription: 20,
						alignment_and_energy: 3,
						consolidation: 1,
					},
					totalProcessingSeconds: 30,
					totalTracks: 1,
					freshAsrTracks: 1,
					textCheckpointReusedTracks: 0,
					completedCheckpointReusedTracks: 0,
					freshAudioWorkSeconds: 60,
					reusedAudioWorkSeconds: 0,
					freshCalibrationEligible: true,
				},
				sessionDurationSeconds: 60,
				durationSemantics: "session_extent_v1",
				rtf: 0.5,
				wordCount: 2,
				segmentCount: 1,
				trackCount: 1,
				turnCount: 1,
				deduplicatedSegmentCount: 0,
				warningCount: 0,
			},
			executionLineage: {
				schemaVersion: "tda_execution_lineage_v1",
				companionVersion: "0.3.14",
				runtimeFamily: "whisper",
				runtimeVersion: "1.1.5",
				device: "cuda",
				computeType: "float16",
				runtimeArtifact: {
					runtimeId: "whisper-ctranslate2",
					version: "1.1.5",
					workerSha256: "a".repeat(64),
					archiveSha256: "b".repeat(64),
				},
				executionDevice: {
					kind: "cuda",
					logicalIndex: 0,
					physicalUuid: "GPU-SYNTHETIC",
					pciBusId: "0000:01:00.0",
				},
				gpu: {
					vendor: "NVIDIA",
					index: 0,
					model: "Synthetic GPU",
					vramTotalBytes: 8 * 1024 ** 3,
					computeCapability: "8.9",
					driverVersion: "synthetic",
				},
			},
		} as LocalRunSummary;
		expect(compareRunPerformanceSemantics(run, run)).toEqual({
			status: "comparable",
			reasons: [],
		});
		const otherDevice = {
			...run,
			executionLineage: {
				...run.executionLineage!,
				executionDevice: {
					...run.executionLineage!.executionDevice!,
					physicalUuid: "GPU-OTHER",
				},
			},
		} as LocalRunSummary;
		expect(compareRunPerformanceSemantics(run, otherDevice)).toMatchObject({
			status: "limited",
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
