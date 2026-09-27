import { freshCalibrationRtf } from "./engine-metrics";
import type {
	LocalRunSummary,
	SystemSnapshot,
	TranscriptionProfileState,
} from "./protocol";

export const PROCESSING_ESTIMATOR_VERSION = "tda_processing_estimator_v1";

export type EstimateConfidence = "low" | "medium" | "high";

export type ProcessingEstimate =
	| Readonly<{
			available: false;
			version: typeof PROCESSING_ESTIMATOR_VERSION;
			reason:
				| "audio_work_unavailable"
				| "profile_identity_unavailable"
				| "gpu_identity_unavailable"
				| "compute_identity_ambiguous"
				| "insufficient_history";
	  }>
	| Readonly<{
			available: true;
			version: typeof PROCESSING_ESTIMATOR_VERSION;
			confidence: EstimateConfidence;
			sampleCount: number;
			lowerSeconds: number;
			medianSeconds: number;
			upperSeconds: number;
			lowerRtf: number;
			medianRtf: number;
			upperRtf: number;
			computeType: string;
			computeTypeVerified: boolean;
			gpuModel: string;
			source: "local_runs";
	  }>;

function quantile(sorted: readonly number[], q: number): number {
	if (sorted.length === 0) return Number.NaN;
	if (sorted.length === 1) return sorted[0] ?? Number.NaN;
	const position = (sorted.length - 1) * q;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	const low = sorted[lower] ?? Number.NaN;
	const high = sorted[upper] ?? Number.NaN;
	if (lower === upper) return low;
	return low + (high - low) * (position - lower);
}

function median(values: readonly number[]): number {
	return quantile([...values].sort((a, b) => a - b), 0.5);
}

function robustRtfs(values: readonly number[]): number[] {
	const finite = values
		.filter((value) => Number.isFinite(value) && value > 0)
		.sort((a, b) => a - b);
	if (finite.length < 5) return finite;
	const center = median(finite);
	const deviations = finite.map((value) => Math.abs(value - center));
	const mad = median(deviations);
	if (!Number.isFinite(mad)) return finite;
	if (mad === 0) {
		const exact = finite.filter((value) => value === center);
		return exact.length >= 2 ? exact : finite;
	}
	const threshold = 3 * 1.4826 * mad;
	const filtered = finite.filter((value) => Math.abs(value - center) <= threshold);
	return filtered.length >= 2 ? filtered : finite;
}

function runRtf(run: LocalRunSummary): number | null {
	// Calibration is intentionally stricter than result display. Legacy RTF and
	// recovered/checkpointed attempts remain valid historical facts, but they
	// are not fresh-ASR throughput samples.
	return freshCalibrationRtf(run.stats.processingMetrics);
}

function currentGpuModel(
	profile: TranscriptionProfileState,
	system: SystemSnapshot | null,
): string | null {
	if (profile.gpuModel) return profile.gpuModel;
	if (system?.gpus.length === 1) return system.gpus[0]?.name ?? null;
	return null;
}

function completedAtValue(run: LocalRunSummary): number {
	const parsed = run.completedAt ? Date.parse(run.completedAt) : 0;
	return Number.isFinite(parsed) ? parsed : 0;
}

export function estimateProfileProcessing(input: Readonly<{
	audioWorkSeconds: number | null;
	profile: TranscriptionProfileState | null;
	runs: readonly LocalRunSummary[];
	system: SystemSnapshot | null;
}>): ProcessingEstimate {
	const { audioWorkSeconds, profile, runs, system } = input;
	if (
		audioWorkSeconds === null ||
		!Number.isFinite(audioWorkSeconds) ||
		audioWorkSeconds <= 0
	)
		return {
			available: false,
			version: PROCESSING_ESTIMATOR_VERSION,
			reason: "audio_work_unavailable",
		};
	if (
		!profile ||
		!profile.model ||
		!profile.modelRevision ||
		!profile.runtimeVersion
	)
		return {
			available: false,
			version: PROCESSING_ESTIMATOR_VERSION,
			reason: "profile_identity_unavailable",
		};

	const gpuModel = currentGpuModel(profile, system);
	if (!gpuModel)
		return {
			available: false,
			version: PROCESSING_ESTIMATOR_VERSION,
			reason: "gpu_identity_unavailable",
		};

	const base = [...runs]
		.sort((left, right) => completedAtValue(right) - completedAtValue(left))
		.filter((run) => {
			const lineage = run.executionLineage;
			return (
				run.profileId === profile.id &&
				run.engine === profile.engine &&
				run.model === profile.model &&
				run.modelRevision === profile.modelRevision &&
				lineage?.runtimeVersion === profile.runtimeVersion &&
				lineage?.gpu?.model === gpuModel &&
				(!profile.gpuComputeCapability ||
					lineage?.gpu?.computeCapability === profile.gpuComputeCapability) &&
				runRtf(run) !== null
			);
		})
		.slice(0, 20);

	let computeType = profile.computeType ?? null;
	let computeTypeVerified = computeType !== null;
	if (!computeType) {
		const observed = new Set(
			base
				.map((run) => run.computeType)
				.filter((value): value is string => Boolean(value)),
		);
		if (observed.size !== 1)
			return {
				available: false,
				version: PROCESSING_ESTIMATOR_VERSION,
				reason: "compute_identity_ambiguous",
			};
		computeType = [...observed][0] ?? null;
	}
	if (!computeType)
		return {
			available: false,
			version: PROCESSING_ESTIMATOR_VERSION,
			reason: "compute_identity_ambiguous",
		};

	const compatible = base.filter((run) => run.computeType === computeType);
	const rtfs = robustRtfs(
		compatible
			.map(runRtf)
			.filter((value): value is number => value !== null),
	);
	if (rtfs.length < 2)
		return {
			available: false,
			version: PROCESSING_ESTIMATOR_VERSION,
			reason: "insufficient_history",
		};

	const sorted = [...rtfs].sort((a, b) => a - b);
	const lowerRtf =
		sorted.length === 2 ? (sorted[0] ?? Number.NaN) : quantile(sorted, 0.25);
	const medianRtf = quantile(sorted, 0.5);
	const upperRtf =
		sorted.length === 2
			? (sorted[sorted.length - 1] ?? Number.NaN)
			: quantile(sorted, 0.75);
	const relativeSpread =
		medianRtf > 0 ? (upperRtf - lowerRtf) / medianRtf : Number.POSITIVE_INFINITY;
	const confidence: EstimateConfidence =
		sorted.length >= 5 && relativeSpread <= 0.15 && computeTypeVerified
			? "high"
			: sorted.length >= 3
				? "medium"
				: "low";

	return {
		available: true,
		version: PROCESSING_ESTIMATOR_VERSION,
		confidence,
		sampleCount: sorted.length,
		lowerSeconds: audioWorkSeconds * lowerRtf,
		medianSeconds: audioWorkSeconds * medianRtf,
		upperSeconds: audioWorkSeconds * upperRtf,
		lowerRtf,
		medianRtf,
		upperRtf,
		computeType,
		computeTypeVerified,
		gpuModel,
		source: "local_runs",
	};
}

export function estimateRemainingProcessing(
	estimate: ProcessingEstimate,
	trackDurationsSeconds: readonly number[] | undefined,
	completedTracks: number,
): Pick<
	Extract<ProcessingEstimate, { available: true }>,
	"lowerSeconds" | "medianSeconds" | "upperSeconds"
> | null {
	if (
		!estimate.available ||
		!trackDurationsSeconds ||
		!Number.isSafeInteger(completedTracks) ||
		completedTracks < 0 ||
		completedTracks >= trackDurationsSeconds.length
	)
		return null;
	const remainingAudio = trackDurationsSeconds
		.slice(completedTracks)
		.reduce((sum, value) => sum + (Number.isFinite(value) && value >= 0 ? value : 0), 0);
	if (remainingAudio <= 0) return null;
	return {
		lowerSeconds: remainingAudio * estimate.lowerRtf,
		medianSeconds: remainingAudio * estimate.medianRtf,
		upperSeconds: remainingAudio * estimate.upperRtf,
	};
}

export function predictionErrorPercent(
	estimate: ProcessingEstimate,
	actualProcessingSeconds: number,
): number | null {
	if (
		!estimate.available ||
		!Number.isFinite(actualProcessingSeconds) ||
		actualProcessingSeconds < 0 ||
		estimate.medianSeconds <= 0
	)
		return null;
	return ((actualProcessingSeconds - estimate.medianSeconds) / estimate.medianSeconds) * 100;
}

export function formatEstimateRange(
	lowerSeconds: number,
	upperSeconds: number,
): string {
	const format = (seconds: number) => {
		const minutes = Math.max(1, Math.round(seconds / 60));
		if (minutes < 60) return `${minutes} min`;
		const hours = Math.floor(minutes / 60);
		const rest = minutes % 60;
		return rest ? `${hours}h ${rest}m` : `${hours}h`;
	};
	return `${format(lowerSeconds)}–${format(upperSeconds)}`;
}

