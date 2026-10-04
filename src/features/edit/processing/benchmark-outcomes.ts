import type {
	BenchmarkPartialResult,
	JobEvent,
	LocalJob,
	TranscriptionProfileId,
} from "./protocol";

export const BENCHMARK_PROFILES = [
	"whisper-turbo",
	"whisper-detailed",
	"qwen-fast",
	"qwen-quality",
] as const satisfies readonly TranscriptionProfileId[];

export type BenchmarkProfileUiStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "not_attempted";

export type BenchmarkProfileUiState = Readonly<{
	profileId: TranscriptionProfileId;
	status: BenchmarkProfileUiStatus;
	errorCode: string | null;
	recoverable: boolean | null;
	scope: "profile" | "benchmark" | null;
	continuation: "continue" | "stop" | null;
	artifactAvailable: boolean;
}>;

export type BenchmarkAttemptUiState = Readonly<{
	profiles: readonly BenchmarkProfileUiState[];
	attemptedCount: number;
	completedCount: number;
	failedCount: number;
	pendingCount: number;
	currentProfile: TranscriptionProfileId | null;
}>;

function profileFromEvent(event: JobEvent): TranscriptionProfileId | null {
	const profile = event.data.profile;
	return typeof profile === "string" &&
		(BENCHMARK_PROFILES as readonly string[]).includes(profile)
		? (profile as TranscriptionProfileId)
		: null;
}

function emptyState(profileId: TranscriptionProfileId): BenchmarkProfileUiState {
	return {
		profileId,
		status: "pending",
		errorCode: null,
		recoverable: null,
		scope: null,
		continuation: null,
		artifactAvailable: false,
	};
}

function terminalizeUnfinished(
	states: Map<TranscriptionProfileId, BenchmarkProfileUiState>,
	job: LocalJob,
) {
	for (const profileId of BENCHMARK_PROFILES) {
		const current = states.get(profileId) ?? emptyState(profileId);
		if (current.status === "pending") {
			states.set(profileId, { ...current, status: "not_attempted" });
			continue;
		}
		if (current.status !== "running") continue;
		if (job.status === "cancelled") {
			states.set(profileId, { ...current, status: "cancelled" });
			continue;
		}
		states.set(profileId, {
			...current,
			status: "failed",
			errorCode: job.error?.code ?? "BENCHMARK_STOPPED",
			recoverable: job.error?.recoverable ?? false,
			scope: "benchmark",
			continuation: "stop",
		});
	}
}

export function deriveBenchmarkAttemptUiState(
	job: LocalJob,
	events: readonly JobEvent[],
	partial: BenchmarkPartialResult | null = null,
): BenchmarkAttemptUiState {
	const states = new Map(
		BENCHMARK_PROFILES.map((profileId) => [profileId, emptyState(profileId)]),
	);

	if (partial) {
		for (const outcome of partial.profiles) {
			states.set(
				outcome.profileId,
				outcome.status === "completed"
					? {
							profileId: outcome.profileId,
							status: "completed",
							errorCode: null,
							recoverable: null,
							scope: null,
							continuation: null,
							artifactAvailable: outcome.artifactAvailable,
						}
					: {
							profileId: outcome.profileId,
							status: "failed",
							errorCode: outcome.error.code,
							recoverable: outcome.error.recoverable,
							scope: outcome.error.scope,
							continuation: outcome.continuation.decision,
							artifactAvailable: false,
						},
			);
		}
	} else {
		const attemptEvents = events.filter(
			(event) => event.attempt === null || event.attempt === job.attempt,
		);
		let sawProfileEvent = false;
		for (const event of attemptEvents) {
			if (
				![
					"BENCHMARK_PROFILE_STARTED",
					"BENCHMARK_PROFILE_COMPLETED",
					"BENCHMARK_PROFILE_FAILED",
				].includes(event.code)
			)
				continue;
			const profileId = profileFromEvent(event);
			if (!profileId) continue;
			sawProfileEvent = true;
			const current = states.get(profileId) ?? emptyState(profileId);
			if (event.code === "BENCHMARK_PROFILE_STARTED") {
				states.set(profileId, { ...current, status: "running" });
				continue;
			}
			if (event.code === "BENCHMARK_PROFILE_COMPLETED") {
				states.set(profileId, {
					...current,
					status: "completed",
					errorCode: null,
					recoverable: null,
					scope: null,
					continuation: null,
					artifactAvailable: true,
				});
				continue;
			}
			const scope = event.data.scope === "profile" ? "profile" : "benchmark";
			states.set(profileId, {
				...current,
				status: "failed",
				errorCode:
					typeof event.data.error_code === "string"
						? event.data.error_code
						: job.error?.code ?? "BENCHMARK_PROFILE_FAILED",
				recoverable:
					typeof event.data.recoverable === "boolean"
						? event.data.recoverable
						: job.error?.recoverable ?? false,
				scope,
				continuation:
					event.data.continuation === "continue" ? "continue" : "stop",
				artifactAvailable: false,
			});
		}

		// Compatibility only: older Companion versions had no profile events and
		// exposed progress.completed as successful sequential profiles.
		if (!sawProfileEvent && job.progress) {
			const legacyCompleted = Math.min(
				job.progress.completed,
				BENCHMARK_PROFILES.length,
			);
			for (let index = 0; index < legacyCompleted; index += 1) {
				const profileId = BENCHMARK_PROFILES[index];
				states.set(profileId, {
					...emptyState(profileId),
					status: "completed",
					artifactAvailable: job.status === "succeeded",
				});
			}
			if (job.status === "running" && legacyCompleted < BENCHMARK_PROFILES.length) {
				const profileId = BENCHMARK_PROFILES[legacyCompleted];
				states.set(profileId, { ...emptyState(profileId), status: "running" });
			}
		}

		if (["failed", "cancelled", "interrupted"].includes(job.status))
			terminalizeUnfinished(states, job);
	}

	const profiles = BENCHMARK_PROFILES.map(
		(profileId) => states.get(profileId) ?? emptyState(profileId),
	);
	const completedCount = profiles.filter((item) => item.status === "completed").length;
	const failedCount = profiles.filter((item) => item.status === "failed").length;
	const attemptedCount = profiles.filter((item) =>
		["running", "completed", "failed", "cancelled"].includes(item.status),
	).length;
	const pendingCount = profiles.filter((item) =>
		["pending", "not_attempted"].includes(item.status),
	).length;
	const currentProfile =
		profiles.find((item) => item.status === "running")?.profileId ?? null;

	return {
		profiles,
		attemptedCount,
		completedCount,
		failedCount,
		pendingCount,
		currentProfile,
	};
}
