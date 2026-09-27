import type { Page, Route } from "@playwright/test";
import {
	CRAIG_SOURCE_ID,
	LOCAL_API,
	installCompanionFixture,
} from "./companion-fixture";

export const BENCHMARK_JOB_ID = "benchmark-job-1";

const PROFILE_IDS = [
	"whisper-turbo",
	"whisper-detailed",
	"qwen-fast",
	"qwen-quality",
] as const;

type BenchmarkProfileId = (typeof PROFILE_IDS)[number];
type BenchmarkProfileMode = "ready" | "preparation_required" | "blocked";
type BenchmarkStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "interrupted";

export type BenchmarkFixtureOptions = {
	profiles?: Partial<Record<BenchmarkProfileId, BenchmarkProfileMode>>;
	shortSample?: boolean;
	resourceBusy?: boolean;
	preparationErrorProfile?: BenchmarkProfileId;
	holdPreparation?: boolean;
	initialStatus?: BenchmarkStatus;
	advanceBenchmark?: boolean;
	jobEvents?: Record<string, unknown>[];
};

export type BenchmarkFixtureState = {
	uploadCount: number;
	benchmarkPostCount: number;
	preparationPostCount: number;
	preparedProfiles: ReadonlySet<BenchmarkProfileId>;
	benchmarkStatus: BenchmarkStatus | null;
};

function json(route: Route, value: unknown, status = 200) {
	return route.fulfill({
		status,
		headers: {
			"Access-Control-Allow-Origin": "http://127.0.0.1:3102",
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
		body: JSON.stringify(value),
	});
}

function error(route: Route, code: string, status = 409, recoverable = true) {
	return json(route, { error: { code, recoverable } }, status);
}

function benchmarkJob(status: BenchmarkStatus): Record<string, unknown> {
	const progress =
		status === "queued"
			? { completed: 0, total: 4, unit: "profiles" }
			: status === "running"
				? { completed: 1, total: 4, unit: "profiles" }
				: { completed: 4, total: 4, unit: "profiles" };
	return {
		id: BENCHMARK_JOB_ID,
		kind: "benchmark.craig",
		status,
		stage:
			status === "queued"
				? "queued"
				: status === "running"
					? "benchmark_profile"
					: status,
		progress,
		error:
			status === "failed"
				? { code: "BENCHMARK_FIXTURE_FAILURE", recoverable: true }
				: null,
		result_available: status === "succeeded",
		updated_at: "2026-09-27T21:00:00Z",
		attempt: 1,
		context: {
			campaign_id: "benchmark-local",
			session_id: "benchmark-local",
			source_id: CRAIG_SOURCE_ID,
			sample_identity_sha256: "c".repeat(64),
			sample_seconds: 300,
			profiles: PROFILE_IDS,
			prepared: true,
		},
	};
}

function benchmarkResult() {
	const profile = (profileId: BenchmarkProfileId, engine: "whisper" | "qwen3") => ({
		schema_version: "tda_benchmark_profile_v1",
		kind: "benchmark.profile",
		profile_id: profileId,
		engine,
		model: `${profileId}-fixture`,
		model_revision: "fixture",
		device: "cuda",
		compute_type: "float16",
		alignment: engine === "qwen3" ? "strict" : "native",
		sample_seconds: 300,
		audio_work_seconds: 600,
		session_duration_seconds: 300,
		processing_timing_version: "engine_processing_v1",
		processing_seconds: 30,
		rtf: 0.05,
		word_count: 100,
		segment_count: 10,
		track_count: 2,
		warning_count: 0,
		execution_lineage: null,
	});
	return {
		schema_version: "tda_processing_benchmark_v1",
		kind: "benchmark.craig",
		job_id: BENCHMARK_JOB_ID,
		source_id: CRAIG_SOURCE_ID,
		campaign_id: "benchmark-local",
		session_id: "benchmark-local",
		sample_identity_sha256: "c".repeat(64),
		sample_seconds: 300,
		execution_mode: "prepared_artifacts_fresh_worker_per_profile_v1",
		track_count: 2,
		audio_work_seconds: 600,
		prepared: true,
		profiles: [
			profile("whisper-turbo", "whisper"),
			profile("whisper-detailed", "whisper"),
			profile("qwen-fast", "qwen3"),
			profile("qwen-quality", "qwen3"),
		],
	};
}

export async function installBenchmarkFixture(
	page: Page,
	options: BenchmarkFixtureOptions = {},
): Promise<BenchmarkFixtureState> {
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
	});

	const configured = new Map<BenchmarkProfileId, BenchmarkProfileMode>(
		PROFILE_IDS.map((id) => [id, options.profiles?.[id] ?? "ready"]),
	);
	const prepared = new Set<BenchmarkProfileId>(
		PROFILE_IDS.filter((id) => configured.get(id) === "ready"),
	);
	let preparation:
		| { profileId: BenchmarkProfileId; operationId: string; state: "running" | "completed" | "failed" | "interrupted" }
		| null = null;
	let status: BenchmarkStatus | null = options.initialStatus ?? null;
	let jobsReads = 0;

	const state: BenchmarkFixtureState = {
		uploadCount: 0,
		benchmarkPostCount: 0,
		preparationPostCount: 0,
		preparedProfiles: prepared,
		benchmarkStatus: status,
	};

	const preparationPayload = () => {
		if (!preparation) {
			return {
				schema: "tda_profile_preparation_v1",
				state: "idle",
				active: false,
				operation_id: null,
				source_id: null,
				profile_id: null,
				engine: null,
				stage: "idle",
				title: "Preparação inativa",
				detail: "",
				sequence: 0,
				elapsed_seconds: 0,
				error_code: null,
			};
		}
		return {
			schema: "tda_profile_preparation_v1",
			state: preparation.state,
			active: preparation.state === "running",
			operation_id: preparation.operationId,
			source_id: CRAIG_SOURCE_ID,
			profile_id: preparation.profileId,
			engine: preparation.profileId.startsWith("qwen-") ? "qwen3" : "whisper",
			stage: preparation.state === "running" ? "download" : preparation.state,
			title: preparation.state === "running" ? "Preparando fixture" : "Preparação finalizada",
			detail: preparation.state === "running" ? "Fixture sintética" : "",
			sequence: 1,
			elapsed_seconds: 0.2,
			error_code:
				preparation.state === "failed" ? "BENCHMARK_PREPARATION_FIXTURE_FAILED" : null,
		};
	};

	await page.route(`${LOCAL_API}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname.replace("/api/v1", "") || "/";

		if (path === "/capabilities" && request.method() === "GET") {
			const catalog = PROFILE_IDS.map((id) => {
				const mode = prepared.has(id) ? "ready" : configured.get(id) ?? "blocked";
				return {
					id,
					engine: id.startsWith("qwen-") ? "qwen3" : "whisper",
					ready: mode === "ready",
					preparation_required: mode === "preparation_required",
					reason:
						mode === "ready"
							? null
							: mode === "preparation_required"
								? "BENCHMARK_PROFILE_PREPARATION_REQUIRED"
								: "BENCHMARK_PROFILE_BLOCKED",
				};
			});
			return json(route, {
				capabilities: [
					"transcription.craig",
					"transcription.prepare",
					"transcription.prepare.cancel",
					"job.events",
					"system.telemetry",
				],
				sync: false,
				device: { id: "fixture-pc", label: "PC sintético" },
				transcription: {
					profiles: PROFILE_IDS.filter((id) => prepared.has(id)),
					catalog,
				},
			});
		}

		if (path === "/sources/craig" && request.method() === "POST") {
			const body = request.postDataBuffer();
			if (!body?.length) return error(route, "CRAIG_UPLOAD_EMPTY", 422, false);
			state.uploadCount += 1;
			return json(route, {
				schema_version: "tda_craig_ingest_v1",
				source_id: CRAIG_SOURCE_ID,
				source_sha256: "a".repeat(64),
				size_bytes: body.length,
				track_count: 2,
				audio_work_seconds: options.shortSample ? 480 : 840,
				session_duration_seconds: options.shortSample ? 240 : 420,
				minimum_track_duration_seconds: options.shortSample ? 240 : 420,
				reused: false,
			});
		}

		if (path === "/preparation" && request.method() === "POST") {
			const payload = request.postDataJSON() as { source_id?: string; profile_id?: string };
			const profileId = payload.profile_id as BenchmarkProfileId;
			if (
				payload.source_id !== CRAIG_SOURCE_ID ||
				!PROFILE_IDS.includes(profileId) ||
				configured.get(profileId) !== "preparation_required"
			) return error(route, "TRANSCRIPTION_PROFILE_INVALID", 422, false);
			state.preparationPostCount += 1;
			const operationId = String(state.preparationPostCount).padStart(32, "c").slice(-32);
			if (options.preparationErrorProfile === profileId) {
				preparation = { profileId, operationId, state: "failed" };
			} else if (options.holdPreparation) {
				preparation = { profileId, operationId, state: "running" };
			} else {
				prepared.add(profileId);
				preparation = { profileId, operationId, state: "completed" };
			}
			return json(route, preparationPayload());
		}

		if (path === "/preparation" && request.method() === "GET") {
			return json(route, preparationPayload());
		}

		if (path === "/preparation/cancel" && request.method() === "POST") {
			if (preparation?.state !== "running")
				return error(route, "PREPARATION_NOT_ACTIVE", 409, true);
			preparation = { ...preparation, state: "interrupted" };
			return json(route, preparationPayload());
		}

		if (path === "/jobs" && request.method() === "POST") {
			const payload = request.postDataJSON() as Record<string, unknown>;
			if (payload.kind !== "benchmark.craig") return route.fallback();
			state.benchmarkPostCount += 1;
			if (options.resourceBusy) return error(route, "BENCHMARK_RESOURCE_BUSY");
			if (options.shortSample) return error(route, "BENCHMARK_SAMPLE_TOO_SHORT");
			if (!PROFILE_IDS.every((id) => prepared.has(id)))
				return error(route, "BENCHMARK_PROFILES_NOT_READY");
			status = "queued";
			state.benchmarkStatus = status;
			jobsReads = 0;
			return json(route, benchmarkJob(status));
		}

		if (path === "/jobs" && request.method() === "GET") {
			if (status && options.advanceBenchmark) {
				jobsReads += 1;
				if (status === "queued" && jobsReads >= 2) status = "running";
				else if (status === "running" && jobsReads >= 4) status = "succeeded";
				state.benchmarkStatus = status;
			}
			return json(route, { jobs: status ? [benchmarkJob(status)] : [] });
		}

		if (path === `/jobs/${BENCHMARK_JOB_ID}/events`) {
			return json(route, {
				events:
					options.jobEvents ??
					(status === "running"
						? [{
							seq: 1,
							attempt: 1,
							code: "BENCHMARK_PROFILE_STARTED",
							at: "2026-09-27T21:00:01Z",
							level: "info",
							data: { profile: "whisper-turbo" },
						}]
						: []),
			});
		}

		if (path === `/jobs/${BENCHMARK_JOB_ID}/result`) {
			return json(route, benchmarkResult());
		}

		if (
			path === `/jobs/${BENCHMARK_JOB_ID}/cancel` &&
			request.method() === "POST"
		) {
			status = "cancelled";
			state.benchmarkStatus = status;
			return json(route, benchmarkJob(status));
		}

		return route.fallback();
	});

	return state;
}
