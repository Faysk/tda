import type {
	LocalReviewListingStatus,
	LocalRunSummary,
} from "./protocol";

export type RunWarningFilter = "all" | "warnings" | "clean";
export type RunReviewFilter =
	| "all"
	| "asr_only"
	| "draft"
	| "reviewed"
	| "approved_local"
	| "invalid";
export type RunLineageFilter = "all" | "lineage" | "legacy";
export type RunDateFilter = "all" | "7d" | "30d";
export type RunSort = "newest" | "rtf" | "duration" | "warnings";

const profileLabels: Record<string, string> = {
	"qwen-fast": "Qwen Fast",
	"qwen-quality": "Qwen Quality",
	"whisper-detailed": "Whisper Detailed",
	"whisper-turbo": "Whisper Turbo",
};

export function runProfileLabel(profileId: string): string {
	return (
		profileLabels[profileId] ??
		profileId
			.split(/[-_.]+/u)
			.filter(Boolean)
			.map((part) => part.charAt(0).toLocaleUpperCase("pt-BR") + part.slice(1))
			.join(" ")
	);
}

export function compactRunId(value: string, head = 14, tail = 6): string {
	if (value.length <= head + tail + 1) return value;
	return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function runSessionLabel(run: LocalRunSummary): string {
	return run.publicationTarget?.sourceSessionId ?? compactRunId(run.sourceId, 16, 8);
}

export function runReviewStatus(
	run: LocalRunSummary,
): LocalReviewListingStatus | "asr_only" {
	return run.reviewSummary?.status ?? "asr_only";
}

export function runReviewLabel(run: LocalRunSummary): string {
	return {
		asr_only: "ASR concluído",
		draft: "Draft",
		reviewed: "Revisado",
		approved_local: "Aprovado localmente",
		invalid: "Revisão indisponível",
	}[runReviewStatus(run)];
}

export function runHasWarnings(run: LocalRunSummary): boolean {
	return (run.stats.warningCount ?? 0) > 0;
}

function normalized(value: string | null | undefined): string {
	return (value ?? "").trim().toLocaleLowerCase("pt-BR");
}

function matchesQuery(run: LocalRunSummary, query: string): boolean {
	const needle = normalized(query);
	if (!needle) return true;
	return [
		runSessionLabel(run),
		run.sourceId,
		run.runId,
		run.profileId,
		runProfileLabel(run.profileId),
		run.engine,
		run.model,
		run.modelRevision,
	]
		.some((value) => normalized(value).includes(needle));
}

function matchesDate(
	run: LocalRunSummary,
	filter: RunDateFilter,
	nowMs: number,
): boolean {
	if (filter === "all") return true;
	if (!run.completedAt) return false;
	const completed = Date.parse(run.completedAt);
	if (!Number.isFinite(completed)) return false;
	const days = filter === "7d" ? 7 : 30;
	return completed >= nowMs - days * 86_400_000;
}

function nullableMetricSort(
	left: number | null,
	right: number | null,
	direction: "asc" | "desc",
): number {
	if (left === null && right === null) return 0;
	if (left === null) return 1;
	if (right === null) return -1;
	return direction === "asc" ? left - right : right - left;
}

function completedMillis(run: LocalRunSummary): number {
	if (!run.completedAt) return 0;
	const parsed = Date.parse(run.completedAt);
	return Number.isFinite(parsed) ? parsed : 0;
}

export function selectRuns(
	runs: readonly LocalRunSummary[],
	options: Readonly<{
		query: string;
		profile: string;
		engine: string;
		warnings: RunWarningFilter;
		review: RunReviewFilter;
		lineage: RunLineageFilter;
		date: RunDateFilter;
		sort: RunSort;
		nowMs?: number;
	}>,
): LocalRunSummary[] {
	const nowMs = options.nowMs ?? Date.now();
	return runs
		.filter((run) => {
			if (!matchesQuery(run, options.query)) return false;
			if (options.profile !== "all" && run.profileId !== options.profile) return false;
			if (options.engine !== "all" && run.engine !== options.engine) return false;
			if (
				options.warnings === "warnings" &&
				!runHasWarnings(run)
			)
				return false;
			if (options.warnings === "clean" && runHasWarnings(run)) return false;
			if (
				options.review !== "all" &&
				runReviewStatus(run) !== options.review
			)
				return false;
			if (
				options.lineage === "lineage" &&
				run.executionLineage === null
			)
				return false;
			if (
				options.lineage === "legacy" &&
				run.executionLineage !== null
			)
				return false;
			return matchesDate(run, options.date, nowMs);
		})
		.sort((left, right) => {
			if (options.sort === "rtf") {
				const metric = nullableMetricSort(left.stats.rtf, right.stats.rtf, "asc");
				if (metric !== 0) return metric;
			}
			if (options.sort === "duration") {
				const metric = nullableMetricSort(
					left.stats.processingSeconds,
					right.stats.processingSeconds,
					"asc",
				);
				if (metric !== 0) return metric;
			}
			if (options.sort === "warnings") {
				const metric = nullableMetricSort(
					left.stats.warningCount,
					right.stats.warningCount,
					"desc",
				);
				if (metric !== 0) return metric;
			}
			return completedMillis(right) - completedMillis(left);
		});
}

export function compatibleRunCount(
	runs: readonly LocalRunSummary[],
	selected: LocalRunSummary,
): number {
	return runs.filter((run) => run.sourceId === selected.sourceId).length;
}
