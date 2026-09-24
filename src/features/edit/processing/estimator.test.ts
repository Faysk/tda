import { describe, expect, it } from "vitest";
import type { LocalRunSummary } from "./protocol";
import {
	calibrationSampleFromRun,
	calibrationSignatureFromRun,
	calibrationSignatureKey,
	estimateMedianErrorPercent,
	estimateProcessingTime,
	type CalibrationSample,
	type CalibrationSignature,
} from "./estimator";

const baseSignature: CalibrationSignature = {
	profileId: "qwen-quality",
	engine: "qwen3",
	model: "Qwen3-ASR",
	modelRevision: "rev-a",
	runtimeFamily: "qwen",
	runtimeVersion: "1.0.10",
	companionVersion: "0.3.14",
	device: "cuda",
	computeType: "bfloat16",
	alignment: "forced-aligner-v1",
	gpuModel: "NVIDIA GeForce RTX 4070 Laptop GPU",
	gpuComputeCapability: "8.9",
	driverVersion: "600.12",
};

function sample(
	rtf: number,
	overrides: Partial<CalibrationSample> = {},
): CalibrationSample {
	return {
		origin: "run",
		signature: baseSignature,
		rtf,
		audioWorkSeconds: 600,
		processingSeconds: 600 * rtf,
		occurredAt: "2026-09-24T20:00:00Z",
		...overrides,
	};
}

function run(
	overrides: Partial<LocalRunSummary> = {},
): LocalRunSummary {
	return {
		runId: "run-1-a1",
		sourceId: "craig-" + "a".repeat(64),
		profileId: "qwen-quality",
		engine: "qwen3",
		model: "Qwen3-ASR",
		modelRevision: "rev-a",
		device: "cuda",
		computeType: "bfloat16",
		alignment: "forced-aligner-v1",
		executionLineage: {
			schemaVersion: "tda_execution_lineage_v1",
			companionVersion: "0.3.14",
			runtimeFamily: "qwen",
			runtimeVersion: "1.0.10",
			device: "cuda",
			computeType: "bfloat16",
			gpu: {
				vendor: "NVIDIA",
				index: 0,
				model: "NVIDIA GeForce RTX 4070 Laptop GPU",
				vramTotalBytes: 8 * 1024 ** 3,
				computeCapability: "8.9",
				driverVersion: "600.12",
			},
		},
		language: "pt",
		completedAt: "2026-09-24T20:00:00Z",
		transcriptSha256: "b".repeat(64),
		transcriptSizeBytes: 1234,
		stats: {
			audioWorkSeconds: 600,
			processingSeconds: 120,
			sessionDurationSeconds: 300,
			rtf: 0.2,
			wordCount: 1000,
			segmentCount: 200,
			trackCount: 2,
			turnCount: 80,
			deduplicatedSegmentCount: 190,
			warningCount: 0,
		},
		publicationTarget: null,
		...overrides,
	};
}

describe("processing estimator", () => {
	it("derives a strict calibration signature from persisted run lineage", () => {
		const signature = calibrationSignatureFromRun(run());
		expect(signature).toEqual(baseSignature);
		expect(calibrationSignatureKey(signature!)).toContain(
			"NVIDIA GeForce RTX 4070 Laptop GPU",
		);
	});

	it("refuses historical CUDA runs without enough hardware/runtime lineage", () => {
		expect(
			calibrationSignatureFromRun(
				run({
					executionLineage: {
						...run().executionLineage!,
						gpu: null,
					},
				}),
			),
		).toBeNull();
		expect(calibrationSignatureFromRun(run({ executionLineage: null }))).toBeNull();
	});

	it("recomputes factual RTF from audio work and processing seconds", () => {
		const value = calibrationSampleFromRun(
			run({
				stats: {
					...run().stats,
					audioWorkSeconds: 800,
					processingSeconds: 160,
					rtf: 999,
				},
			}),
		);
		expect(value?.rtf).toBe(0.2);
	});

	it("uses the median and IQR so one extreme outlier does not control the estimate", () => {
		const estimate = estimateProcessingTime({
			audioWorkSeconds: 3600,
			signature: baseSignature,
			samples: [
				sample(0.18),
				sample(0.19),
				sample(0.2),
				sample(0.21),
				sample(3.5),
			],
		});
		expect(estimate.status).toBe("available");
		if (estimate.status !== "available") return;
		expect(estimate.medianRtf).toBe(0.2);
		expect(estimate.medianSeconds).toBe(720);
		expect(estimate.upperRtf).toBe(0.21);
		expect(estimate.confidence).toBe("high");
	});

	it("never mixes a different GPU/runtime signature into calibration", () => {
		const otherGpu: CalibrationSignature = {
			...baseSignature,
			gpuModel: "NVIDIA GeForce RTX 3090",
			gpuComputeCapability: "8.6",
		};
		const otherRuntime: CalibrationSignature = {
			...baseSignature,
			runtimeVersion: "1.0.11",
		};
		const estimate = estimateProcessingTime({
			audioWorkSeconds: 600,
			signature: baseSignature,
			samples: [
				sample(0.2),
				sample(0.05, { signature: otherGpu }),
				sample(0.04, { signature: otherRuntime }),
			],
		});
		expect(estimate.status).toBe("available");
		if (estimate.status !== "available") return;
		expect(estimate.sampleCount).toBe(1);
		expect(estimate.medianRtf).toBe(0.2);
		expect(estimate.confidence).toBe("low");
		expect(estimate.lowerSeconds).toBeNull();
		expect(estimate.upperSeconds).toBeNull();
	});

	it("combines compatible benchmark and run observations without ranking profiles", () => {
		const estimate = estimateProcessingTime({
			audioWorkSeconds: 1200,
			signature: baseSignature,
			samples: [
				sample(0.18),
				sample(0.2),
				sample(0.22, { origin: "benchmark" }),
			],
		});
		expect(estimate.status).toBe("available");
		if (estimate.status !== "available") return;
		expect(estimate.runCount).toBe(2);
		expect(estimate.benchmarkCount).toBe(1);
		expect(estimate.medianSeconds).toBeCloseTo(240, 8);
		expect(estimate.confidence).toBe("medium");
	});

	it("reports unavailable instead of inventing estimates for zero work or no compatible history", () => {
		expect(
			estimateProcessingTime({
				audioWorkSeconds: 0,
				signature: baseSignature,
				samples: [sample(0.2)],
			}),
		).toMatchObject({
			status: "unavailable",
			reason: "audio_work_unavailable",
		});
		expect(
			estimateProcessingTime({
				audioWorkSeconds: 300,
				signature: { ...baseSignature, profileId: "qwen-fast" },
				samples: [sample(0.2)],
			}),
		).toMatchObject({
			status: "unavailable",
			reason: "no_compatible_samples",
		});
	});

	it("keeps prediction error signed and based on the predicted median", () => {
		expect(
			estimateMedianErrorPercent({ medianSeconds: 100 }, 110),
		).toBeCloseTo(10, 8);
		expect(
			estimateMedianErrorPercent({ medianSeconds: 100 }, 90),
		).toBeCloseTo(-10, 8);
		expect(estimateMedianErrorPercent({ medianSeconds: 100 }, 0)).toBeNull();
	});
});
