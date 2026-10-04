import type {
	JobEvent,
	JobStatus,
	TranscriptionProfileId,
} from "./protocol";

export const BENCHMARK_PROFILE_ORDER = [
	"whisper-turbo",
	"whisper-detailed",
	"qwen-fast",
	"qwen-quality",
] as const satisfies readonly TranscriptionProfileId[];

export type BenchmarkProfileLiveStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed";

export type BenchmarkProfileLiveState = Readonly<{
	profileId: TranscriptionProfileId;
	status: BenchmarkProfileLiveStatus;
	errorCode: string | null;
}>;

export type BenchmarkLiveState = Readonly<{
	profiles: readonly BenchmarkProfileLiveState[];
	attempted: number;
	completed: number;
	failed: number;
	currentProfile: TranscriptionProfileId | null;
}>;

function profileFromEvent(event: JobEvent): TranscriptionProfileId | null {
	const value = event.data.profile;
	return typeof value === "string" &&
		BENCHMARK_PROFILE_ORDER.includes(value as TranscriptionProfileId)
		? (value as TranscriptionProfileId)
		: null;
}

function countFromEvent(event: JobEvent, key: string): number | null {
	const value = event.data[key];
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

export function deriveBenchmarkLiveState(
	events: readonly JobEvent[],
	fallbackAttempted: number,
	jobStatus: JobStatus,
): BenchmarkLiveState {
	const states = new Map<
		TranscriptionProfileId,
		{ status: BenchmarkProfileLiveStatus; errorCode: string | null }
	>(
		BENCHMARK_PROFILE_ORDER.map((profileId) => [
			profileId,
			{ status: "pending", errorCode: null },
		]),
	);
	let attempted = 0;
	let completed = 0;
	let failed = 0;
	let currentProfile: TranscriptionProfileId | null = null;
	let sawStructuredEvent = false;

	for (const event of events) {
		if (
			event.code !== "BENCHMARK_PROFILE_STARTED" &&
			event.code !== "BENCHMARK_PROFILE_COMPLETED" &&
			event.code !== "BENCHMARK_PROFILE_FAILED"
		)
			continue;
		const profileId = profileFromEvent(event);
		if (!profileId) continue;
		sawStructuredEvent = true;
		attempted = countFromEvent(event, "attempted_count") ?? attempted;
		completed = countFromEvent(event, "completed_count") ?? completed;
		failed = countFromEvent(event, "failed_count") ?? failed;
		if (event.code === "BENCHMARK_PROFILE_STARTED") {
			for (const [id, value] of states)
				if (value.status === "running" && id !== profileId)
					states.set(id, { ...value, status: "pending" });
			states.set(profileId, { status: "running", errorCode: null });
			currentProfile = profileId;
			continue;
		}
		if (event.code === "BENCHMARK_PROFILE_COMPLETED") {
			states.set(profileId, { status: "completed", errorCode: null });
			if (currentProfile === profileId) currentProfile = null;
			continue;
		}
		const rawError = event.data.error_code;
		states.set(profileId, {
			status: "failed",
			errorCode: typeof rawError === "string" ? rawError : null,
		});
		if (currentProfile === profileId) currentProfile = null;
	}

	if (!sawStructuredEvent) {
		const bounded = Math.max(
			0,
			Math.min(BENCHMARK_PROFILE_ORDER.length, fallbackAttempted),
		);
		attempted = bounded;
		completed = bounded;
		for (let index = 0; index < bounded; index += 1) {
			const profileId = BENCHMARK_PROFILE_ORDER[index]!;
			states.set(profileId, { status: "completed", errorCode: null });
		}
		if (jobStatus === "running" && bounded < BENCHMARK_PROFILE_ORDER.length) {
			currentProfile = BENCHMARK_PROFILE_ORDER[bounded]!;
			states.set(currentProfile, { status: "running", errorCode: null });
			attempted = Math.max(attempted, bounded + 1);
		}
	}

	return {
		profiles: BENCHMARK_PROFILE_ORDER.map((profileId) => ({
			profileId,
			...states.get(profileId)!,
		})),
		attempted,
		completed,
		failed,
		currentProfile,
	};
}
