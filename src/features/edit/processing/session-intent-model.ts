import type {
	LocalJob,
	LocalRunSummary,
	LocalSourceSummary,
	SessionWorkspace,
	SessionWorkspacePart,
} from "./protocol";

export type IntentPartProgress = "waiting" | "running" | "completed" | "failed";

export type IntentProgress = Readonly<{
	total: number;
	waiting: number;
	running: number;
	completed: number;
	failed: number;
}>;

export type IntentRunChoice =
	| Readonly<{ kind: "selected"; runId: string }>
	| Readonly<{ kind: "automatic"; runId: string; reason: "intent_job" | "single_run" }>
	| Readonly<{ kind: "ambiguous"; runIds: readonly string[] }>
	| Readonly<{ kind: "missing" }>;

export type RecordingVariantConflict = Readonly<{
	sourceId: string;
	recordingId: string;
	conflictsWith: readonly string[];
}>;

function latestJob(
	jobs: readonly LocalJob[],
	sourceId: string,
): LocalJob | null {
	return (
		jobs
			.filter((job) => job.context?.sourceId === sourceId)
			.sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0] ??
		null
	);
}

export function intentProgress(
	workspace: SessionWorkspace | null,
	runsBySource: ReadonlyMap<string, readonly LocalRunSummary[]>,
	jobs: readonly LocalJob[],
): IntentProgress {
	const counts = {
		total: workspace?.parts.length ?? 0,
		waiting: 0,
		running: 0,
		completed: 0,
		failed: 0,
	};
	if (!workspace) return counts;

	for (const part of workspace.parts) {
		if (part.selectedRunId || (runsBySource.get(part.sourceId)?.length ?? 0) > 0) {
			counts.completed += 1;
			continue;
		}
		const job = latestJob(jobs, part.sourceId);
		if (job?.status === "queued" || job?.status === "running") {
			counts.running += 1;
			continue;
		}
		if (
			job?.status === "failed" ||
			job?.status === "cancelled" ||
			job?.status === "interrupted"
		) {
			counts.failed += 1;
			continue;
		}
		counts.waiting += 1;
	}
	return counts;
}

export function chooseIntentRun(
	part: SessionWorkspacePart,
	runs: readonly LocalRunSummary[],
	intentRunId: string | null | undefined,
): IntentRunChoice {
	if (part.selectedRunId) return { kind: "selected", runId: part.selectedRunId };
	if (intentRunId && runs.some((run) => run.runId === intentRunId))
		return { kind: "automatic", runId: intentRunId, reason: "intent_job" };
	const onlyRun = runs.length === 1 ? runs[0] : undefined;
	if (onlyRun)
		return { kind: "automatic", runId: onlyRun.runId, reason: "single_run" };
	if (runs.length > 1)
		return { kind: "ambiguous", runIds: runs.map((run) => run.runId) };
	return { kind: "missing" };
}

export function uniqueIntentSources<T extends Readonly<{ sourceId: string }>>(
	sources: readonly T[],
): readonly T[] {
	const seen = new Set<string>();
	return sources.filter((source) => {
		if (seen.has(source.sourceId)) return false;
		seen.add(source.sourceId);
		return true;
	});
}

export function recordingVariantConflicts(
	sourceIds: readonly string[],
	catalog: ReadonlyMap<string, LocalSourceSummary>,
): readonly RecordingVariantConflict[] {
	const selected = new Set(sourceIds);
	const byRecording = new Map<string, string[]>();
	for (const sourceId of sourceIds) {
		const recordingId = catalog.get(sourceId)?.recordingId;
		if (!recordingId) continue;
		const group = byRecording.get(recordingId) ?? [];
		group.push(sourceId);
		byRecording.set(recordingId, group);
	}
	const conflicts: RecordingVariantConflict[] = [];
	for (const [recordingId, ids] of byRecording) {
		const distinct = [...new Set(ids)];
		if (distinct.length < 2) continue;
		for (const sourceId of distinct) {
			conflicts.push({
				sourceId,
				recordingId,
				conflictsWith: distinct.filter(
					(candidate) => candidate !== sourceId && selected.has(candidate),
				),
			});
		}
	}
	return conflicts;
}

export function trustedTimelineSourceOrder(
	workspace: SessionWorkspace,
): readonly string[] | null {
	if (!workspace.timeline.automaticOrderAvailable || workspace.parts.length < 2)
		return null;
	const values = workspace.parts.map((part) => {
		if (
			part.sourceStartConfidence !== "trusted_absolute" ||
			!part.sourceStartUtc
		)
			return null;
		const epoch = Date.parse(part.sourceStartUtc);
		return Number.isFinite(epoch) ? { sourceId: part.sourceId, epoch } : null;
	});
	if (values.some((value) => value === null)) return null;
	const trusted = values.filter(
		(value): value is Readonly<{ sourceId: string; epoch: number }> => value !== null,
	);
	if (new Set(trusted.map((value) => value.epoch)).size !== trusted.length) return null;
	return [...trusted]
		.sort((left, right) => left.epoch - right.epoch || left.sourceId.localeCompare(right.sourceId))
		.map((value) => value.sourceId);
}

export function trustedTimelineOrderDiffers(
	workspace: SessionWorkspace,
	editorialOrder: readonly string[] = workspace.parts.map((part) => part.sourceId),
): boolean {
	const trusted = trustedTimelineSourceOrder(workspace);
	if (!trusted) return false;
	if (trusted.length !== editorialOrder.length) return true;
	return trusted.some((sourceId, index) => editorialOrder[index] !== sourceId);
}

export function retryableIntentJob(
	jobs: readonly LocalJob[],
	sourceId: string,
): LocalJob | null {
	const job = latestJob(jobs, sourceId);
	if (!job) return null;
	return job.status === "failed" ||
		job.status === "cancelled" ||
		job.status === "interrupted"
		? job
		: null;
}
