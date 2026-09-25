import type { Page, Route } from "@playwright/test";

export const LOCAL_API = "http://127.0.0.1:8765/api/v1";
export const UI_ORIGIN = "http://127.0.0.1:3102";
export const BROWSER_TOKEN = "browser_session_fixture_123456789012345678901234567890";

const sourceSha = "a".repeat(64);
export const CRAIG_SOURCE_ID = `craig-${sourceSha}`;
export const TRANSCRIPT_SHA = "b".repeat(64);
export const SECOND_SOURCE_SHA = "c".repeat(64);
export const SECOND_SOURCE_ID = `craig-${SECOND_SOURCE_SHA}`;

export type FixtureJobStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "interrupted";

export type FixtureSystemGpu = {
	index: number;
	name: string;
	utilizationPercent: number | null;
	memoryUsedBytes: number | null;
	memoryTotalBytes: number | null;
};

export type FixtureSystemSnapshot = {
	sampledAt?: string;
	os?: string;
	cpuModel?: string | null;
	cpuPercent?: number | null;
	memoryUsedBytes?: number | null;
	memoryTotalBytes?: number | null;
	memoryPercent?: number | null;
	gpus?: FixtureSystemGpu[];
};

export type CompanionFixtureOptions = {
	apiVersion?: string;
	serviceVersion?: string;
	lifecycle?: "preparing" | "ready" | "paused";
	initialJobs?: Record<string, unknown>[];
	expireBrowserSessionOnce?: boolean;
	profileReady?: boolean;
	transcriptionUnavailable?: boolean;
	advanceJobs?: boolean;
	ambiguousJobPostOnce?: boolean;
	jobReadDelayMs?: number;
	uploadDelayMs?: number;
	system?: FixtureSystemSnapshot;
	localRuns?: Record<string, unknown>[];
	localReviews?: Record<string, Record<string, unknown>>;
};

export type CompanionFixtureState = {
	requests: { method: string; path: string; authorization?: string; idempotencyKey?: string }[];
	sessionCount: number;
	uploadCount: number;
	jobPostCount: number;
	preparationPostCount: number;
	idempotencyKeys: string[];
	jobStatusesServed: string[];
	job: Record<string, unknown> | null;
	setJob(job: Record<string, unknown> | null): void;
	setLifecycle(value: "preparing" | "ready" | "paused"): void;
	setSystem(value: FixtureSystemSnapshot | undefined): void;
	setLocalReview(runId: string, value: Record<string, unknown>): void;
};

export function fixtureJob(
	status: FixtureJobStatus,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	const terminal = status === "succeeded";
	return {
		id: "craig-job-1",
		kind: "transcription.craig",
		status,
		stage:
			status === "queued"
				? "queued"
				: status === "running"
					? "transcription"
					: status,
		progress:
			status === "queued"
				? { completed: 0, total: 2, unit: "tracks" }
				: status === "running"
					? { completed: 1, total: 2, unit: "tracks" }
					: { completed: 2, total: 2, unit: "tracks" },
		error: null,
		result_available: terminal,
		updated_at: "2026-09-20T18:00:00Z",
		attempt: 1,
		context: {
			campaign_id: "yuhara-main",
			session_id: "sessao-42",
			source_id: CRAIG_SOURCE_ID,
			profile_id: "qwen-quality",
		},
		...overrides,
	};
}

export function fixtureRun(
	runId: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		run_id: runId,
		status: "completed",
		source_id: CRAIG_SOURCE_ID,
		profile_id: "qwen-quality",
		engine: "qwen3",
		model: "Qwen3-ASR",
		model_revision: "test-rev",
		device: "cuda",
		compute_type: "float16",
		alignment: "forced",
		execution_lineage: {
			schema_version: "tda_execution_lineage_v1",
			companion_version: "0.3.14",
			runtime_family: "qwen",
			runtime_version: "1.0.0",
			device: "cuda",
			compute_type: "float16",
			gpu: {
				vendor: "NVIDIA",
				index: 0,
				model: "Synthetic GPU",
				vram_total_bytes: 8 * 1024 ** 3,
				compute_capability: "8.9",
				driver_version: "600.12",
			},
		},
		language: "pt",
		completed_at: "2026-09-25T10:00:00Z",
		transcript_sha256: TRANSCRIPT_SHA,
		transcript_size_bytes: 4096,
		stats: {
			audio_work_seconds: 3600,
			processing_seconds: 600,
			session_duration_seconds: 1800,
			rtf: 1 / 6,
			word_count: 12000,
			segment_count: 800,
			track_count: 4,
			turn_count: 320,
			deduplicated_segment_count: 12,
			warning_count: 0,
		},
		publication_target: {
			schema_version: "tda_publication_target_v1",
			campaign_slug: "yuhara-main",
			source_session_id: "sessao-42",
			source_id: CRAIG_SOURCE_ID,
			run_id: runId,
			job_id: "craig-job-1",
			attempt: 1,
			transcript_sha256: TRANSCRIPT_SHA,
		},
		review_summary: null,
		...overrides,
	};
}

export function fixtureReview(
	runId: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		schema_version: "tda_local_review_v1",
		source_id: CRAIG_SOURCE_ID,
		run_id: runId,
		base_transcript_sha256: TRANSCRIPT_SHA,
		draft_revision: 0,
		draft_sha256: "d".repeat(64),
		status: "draft",
		created_at: "2026-09-25T10:01:00Z",
		updated_at: "2026-09-25T10:01:00Z",
		lineage: {
			profile_id: "qwen-quality",
			engine: "qwen3",
			model: "Qwen3-ASR",
			model_revision: "test-rev",
			device: "cuda",
			compute_type: "float16",
			alignment: "forced",
			execution_lineage: null,
			completed_at: "2026-09-25T10:00:00Z",
		},
		stats: {
			audio_work_seconds: 3600,
			processing_seconds: 600,
			session_duration_seconds: 1800,
			rtf: 1 / 6,
			word_count: 4,
			segment_count: 2,
			track_count: 1,
		},
		warnings: [],
		publication_target: null,
		review: {
			reviewed_segments: 0,
			total_segments: 2,
			review_percent: 0,
			edited_segments: 0,
			word_count: 4,
			warning_count: 0,
		},
		segments: [
			{
				track_number: 1,
				segment_id: "1-0",
				start: 0,
				end: 1,
				text: "Texto local um",
				speaker: "Alice",
				reviewed: false,
			},
			{
				track_number: 1,
				segment_id: "1-1",
				start: 1.2,
				end: 2.4,
				text: "Texto local dois",
				speaker: "Bob",
				reviewed: false,
			},
		],
		sync: { status: "not_configured" },
		...overrides,
	};
}

function json(route: Route, value: unknown, status = 200) {
	return route.fulfill({
		status,
		headers: {
			"Access-Control-Allow-Origin": UI_ORIGIN,
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
		body: JSON.stringify(value),
	});
}


function invalidRequest(route: Route, code = "INVALID_REQUEST") {
	return json(route, { error: { code, recoverable: false } }, 422);
}

function exactObject(
	value: unknown,
	expected: Readonly<Record<string, unknown>>,
): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	const expectedKeys = Object.keys(expected).sort();
	const actualKeys = Object.keys(row).sort();
	if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) return false;
	return expectedKeys.every((key) => row[key] === expected[key]);
}

export async function installCompanionFixture(
	page: Page,
	options: CompanionFixtureOptions = {},
): Promise<CompanionFixtureState> {
	let lifecycle = options.lifecycle ?? "ready";
	const additionalJobs = (options.initialJobs ?? []).slice(1);
	let systemState = options.system;
	const localRuns = [...(options.localRuns ?? [])];
	const localReviews = new Map(
		Object.entries(options.localReviews ?? {}),
	);
	let prepared = options.profileReady ?? false;
	let preparationReads = 0;
	let jobsReads = 0;
	let jobsGetCount = 0;
	let expired = false;
	let ambiguousJobPostConsumed = false;
	let submittedJob = false;
	const state: CompanionFixtureState = {
		requests: [],
		sessionCount: 0,
		uploadCount: 0,
		jobPostCount: 0,
		preparationPostCount: 0,
		idempotencyKeys: [],
		jobStatusesServed: [],
		job: options.initialJobs?.[0] ?? null,
		setJob(value) {
			state.job = value;
			jobsReads = 0;
		},
		setLifecycle(value) {
			lifecycle = value;
		},
		setSystem(value) {
			systemState = value;
		},
		setLocalReview(runId, value) {
			localReviews.set(runId, value);
		},
	};

	await page.route(`${LOCAL_API}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname.replace("/api/v1", "") || "/";
		const authorization = request.headers().authorization;
		const idempotencyKey = request.headers()["idempotency-key"];
		state.requests.push({
			method: request.method(),
			path,
			...(authorization ? { authorization } : {}),
			...(idempotencyKey ? { idempotencyKey } : {}),
		});

		if (path === "/health") {
			return json(route, {
				api_version: options.apiVersion ?? "1",
				service_version: options.serviceVersion ?? "0.3.14",
				lifecycle,
			});
		}
		if (path === "/session" && request.method() === "POST") {
			state.sessionCount += 1;
			return json(route, {
				schema: "tda_loopback_session_v1",
				token: BROWSER_TOKEN,
				expires_in_seconds: 300,
			});
		}

		if (
			options.expireBrowserSessionOnce &&
			!expired &&
			path === "/capabilities" &&
			authorization === `Bearer ${BROWSER_TOKEN}`
		) {
			expired = true;
			return json(
				route,
				{ error: { code: "UNAUTHORIZED", recoverable: true } },
				401,
			);
		}

		if (!authorization?.startsWith("Bearer ")) {
			return json(
				route,
				{ error: { code: "UNAUTHORIZED", recoverable: false } },
				401,
			);
		}

		if (path === "/capabilities") {
			const transcriptionUnavailable = options.transcriptionUnavailable ?? false;
			return json(route, {
				capabilities: [
					...(transcriptionUnavailable
						? []
						: ["transcription.craig", "transcription.prepare"]),
					"job.events",
					"system.telemetry",
					...(localRuns.length ? ["transcription.review"] : []),
				],
				sync: false,
				device: { id: "fixture-pc", label: "PC sintético" },
				transcription: transcriptionUnavailable
					? { profiles: [], catalog: [] }
					: {
							profiles: prepared ? ["qwen-quality"] : [],
							catalog: [
								{
									id: "qwen-quality",
									engine: "qwen3",
									ready: prepared,
									preparation_required: !prepared,
									reason: prepared
										? null
										: "QWEN_PHYSICAL_ACCEPTANCE_REQUIRED",
								},
							],
						},
			});
		}
		if (path === "/sources" && request.method() === "GET") {
			const sources = Array.from(
				new Set(
					localRuns
						.map((run) => run.source_id)
						.filter((value): value is string => typeof value === "string"),
				),
			).map((sourceId) => {
				const sha = sourceId.startsWith("craig-")
					? sourceId.slice("craig-".length)
					: "";
				const tracks = localRuns
					.filter((run) => run.source_id === sourceId)
					.map((run) => {
						const stats = run.stats;
						return stats && typeof stats === "object" && !Array.isArray(stats)
							? (stats as Record<string, unknown>).track_count
							: null;
					})
					.find((value) => typeof value === "number");
				return {
					source_id: sourceId,
					source_sha256: sha,
					recording_id: null,
					track_count: typeof tracks === "number" && tracks > 0 ? tracks : 1,
				};
			});
			return json(route, {
				schema_version: "tda_craig_sources_v1",
				sources,
			});
		}

		const localRunsMatch = path.match(/^\/sources\/([^/]+)\/runs$/u);
		if (localRunsMatch && request.method() === "GET") {
			const sourceId = localRunsMatch[1];
			return json(route, {
				schema_version: "tda_transcription_runs_v1",
				source_id: sourceId,
				runs: localRuns.filter((run) => run.source_id === sourceId),
			});
		}

		const localReviewMatch = path.match(
			/^\/sources\/([^/]+)\/runs\/([^/]+)\/review$/u,
		);
		if (localReviewMatch && request.method() === "GET") {
			const [, sourceId, runId] = localReviewMatch;
			const review = localReviews.get(runId);
			if (!review || review.source_id !== sourceId)
				return json(
					route,
					{ error: { code: "LOCAL_REVIEW_RUN_NOT_VISIBLE", recoverable: false } },
					404,
				);
			return json(route, review);
		}
		if (localReviewMatch && request.method() === "POST") {
			const [, sourceId, runId] = localReviewMatch;
			const review = localReviews.get(runId);
			if (!review || review.source_id !== sourceId)
				return json(
					route,
					{ error: { code: "LOCAL_REVIEW_RUN_NOT_VISIBLE", recoverable: false } },
					404,
				);
			const payload = request.postDataJSON() as {
				expected_draft_revision?: number;
				status?: string;
				segments?: unknown[];
			};
			if (
				payload.expected_draft_revision !== review.draft_revision ||
				!["draft", "reviewed", "approved_local"].includes(
					String(payload.status),
				) ||
				!Array.isArray(payload.segments)
			)
				return invalidRequest(route, "LOCAL_REVIEW_DRAFT_CONFLICT");
			const nextRevision = Number(review.draft_revision) + 1;
			const next = {
				...review,
				draft_revision: nextRevision,
				draft_sha256: "e".repeat(64),
				status: payload.status,
				updated_at: "2026-09-25T10:05:00Z",
				segments: payload.segments,
				review: {
					...(review.review as Record<string, unknown>),
					reviewed_segments: payload.segments.filter(
						(item) =>
							item &&
							typeof item === "object" &&
							!Array.isArray(item) &&
							(item as Record<string, unknown>).reviewed === true,
					).length,
					review_percent:
						payload.segments.length === 0
							? 100
							: (payload.segments.filter(
									(item) =>
										item &&
										typeof item === "object" &&
										!Array.isArray(item) &&
										(item as Record<string, unknown>).reviewed === true,
								).length /
									payload.segments.length) *
								100,
				},
			};
			localReviews.set(runId, next);
			return json(route, next);
		}

		if (path === "/system") {
			const system = systemState;
			return json(route, {
				sampled_at: system?.sampledAt ?? "2026-09-20T18:00:00Z",
				host: {
					os: system?.os ?? "Windows 11",
					cpu: system?.cpuModel === undefined ? "Synthetic CPU" : system.cpuModel,
				},
				cpu: {
					utilization_percent:
						system?.cpuPercent === undefined ? 25 : system.cpuPercent,
				},
				memory: {
					used_bytes:
						system?.memoryUsedBytes === undefined
							? 8 * 1024 ** 3
							: system.memoryUsedBytes,
					total_bytes:
						system?.memoryTotalBytes === undefined
							? 32 * 1024 ** 3
							: system.memoryTotalBytes,
					percent:
						system?.memoryPercent === undefined ? 25 : system.memoryPercent,
				},
				gpus: (system?.gpus ?? []).map((gpu) => ({
					index: gpu.index,
					name: gpu.name,
					utilization_percent: gpu.utilizationPercent,
					memory_used_bytes: gpu.memoryUsedBytes,
					memory_total_bytes: gpu.memoryTotalBytes,
				})),
			});
		}
		if (path === "/sources/craig" && request.method() === "POST") {
			if (options.uploadDelayMs)
				await new Promise((resolve) => setTimeout(resolve, options.uploadDelayMs));
			const contentType = request.headers()["content-type"] ?? "";
			if (!contentType.startsWith("application/zip"))
				return json(
					route,
					{ error: { code: "CRAIG_ZIP_REQUIRED", recoverable: false } },
					415,
				);
			const body = request.postDataBuffer();
			if (!body || body.length === 0)
				return invalidRequest(route, "CRAIG_UPLOAD_EMPTY");
			state.uploadCount += 1;
			return json(route, {
				schema_version: "tda_craig_ingest_v1",
				source_id: CRAIG_SOURCE_ID,
				source_sha256: sourceSha,
				size_bytes: 2048,
				track_count: 2,
				reused: false,
			});
		}
		if (path === "/preparation" && request.method() === "POST") {
			let payload: unknown;
			try {
				payload = request.postDataJSON();
			} catch {
				return invalidRequest(route);
			}
			if (
				!exactObject(payload, {
					source_id: CRAIG_SOURCE_ID,
					profile_id: "qwen-quality",
				})
			)
				return invalidRequest(route);
			state.preparationPostCount += 1;
			preparationReads = 0;
			return json(route, {
				schema: "tda_profile_preparation_v1",
				state: "running",
				active: true,
				operation_id: "prep-1",
				source_id: CRAIG_SOURCE_ID,
				profile_id: "qwen-quality",
				engine: "qwen3",
				stage: "qwen_probe",
				title: "Validando Qwen",
				detail: "Fixture local",
				sequence: 1,
				elapsed_seconds: 0.1,
				error_code: null,
			});
		}
		if (path === "/preparation" && request.method() === "GET") {
			preparationReads += 1;
			if (preparationReads >= 1) prepared = true;
			return json(route, {
				schema: "tda_profile_preparation_v1",
				state: "completed",
				active: false,
				operation_id: "prep-1",
				source_id: CRAIG_SOURCE_ID,
				profile_id: "qwen-quality",
				engine: "qwen3",
				stage: "complete",
				title: "Qwen pronto",
				detail: "",
				sequence: 2,
				elapsed_seconds: 0.2,
				error_code: null,
			});
		}
		if (path === "/jobs" && request.method() === "POST") {
			let payload: unknown;
			try {
				payload = request.postDataJSON();
			} catch {
				return invalidRequest(route);
			}
			if (
				!idempotencyKey ||
				!/^[A-Za-z0-9_-]{1,128}$/u.test(idempotencyKey) ||
				!exactObject(payload, {
					kind: "transcription.craig",
					campaign_id: "yuhara-main",
					session_id: "sessao-42",
					source_id: CRAIG_SOURCE_ID,
					profile_id: "qwen-quality",
					glossary: "",
					context: "",
					cpu: false,
				})
			)
				return invalidRequest(route);
			state.jobPostCount += 1;
			state.idempotencyKeys.push(idempotencyKey);
			state.job = fixtureJob("queued");
			submittedJob = true;
			jobsReads = 0;
			if (options.ambiguousJobPostOnce && !ambiguousJobPostConsumed) {
				ambiguousJobPostConsumed = true;
				return route.abort("failed");
			}
			return json(route, state.job);
		}
		if (path === "/jobs" && request.method() === "GET") {
			jobsGetCount += 1;
			if (options.jobReadDelayMs && jobsGetCount > 1)
				await new Promise((resolve) =>
					setTimeout(resolve, options.jobReadDelayMs),
				);
			if (
				state.job &&
				submittedJob &&
				(options.advanceJobs ?? true)
			) {
				jobsReads += 1;
				if (jobsReads === 2) state.job = fixtureJob("running");
				else if (jobsReads >= 3) state.job = fixtureJob("succeeded");
			}
			const status = state.job?.status;
			if (typeof status === "string") state.jobStatusesServed.push(status);
			return json(route, {
				jobs: state.job
					? [
							state.job,
							...additionalJobs.filter(
								(job) => job.id !== state.job?.id,
							),
						]
					: additionalJobs,
			});
		}
		if (path === "/jobs/craig-job-1/events") {
			return json(route, {
				events:
					state.job?.status === "running"
						? [
								{
									seq: 2,
									code: "QWEN_WINDOW_TRANSCRIBED",
									at: "2026-09-20T18:00:01Z",
									level: "info",
									data: {
										track: 1,
										total_tracks: 2,
										speaker: "Alice",
										window: 1,
									},
								},
							]
						: [],
			});
		}
		if (path === "/jobs/craig-job-1/result") {
			return json(route, {
				schema_version: "tda_local_result_v1",
				campaign_id: "yuhara-main",
				session_id: "sessao-42",
				source_id: CRAIG_SOURCE_ID,
				job_id: "craig-job-1",
				transcription: {
					schema_version: "tda_transcript_v1",
					profile_id: "qwen-quality",
					artifact: "transcript.json",
					run_id: "run-craig-job-1-a1",
					sha256: TRANSCRIPT_SHA,
				},
				sync: { status: "not_configured" },
			});
		}
		if (
			path === "/jobs/craig-job-1/cancel" &&
			request.method() === "POST"
		) {
			state.job = fixtureJob("cancelled");
			return json(route, state.job);
		}
		if (
			path === "/jobs/craig-job-1/retry" &&
			request.method() === "POST"
		) {
			state.job = fixtureJob("queued", { attempt: 2 });
			jobsReads = 0;
			return json(route, state.job);
		}
		if (path === "/lifecycle" && request.method() === "POST") {
			const payload = request.postDataJSON() as { action?: string };
			lifecycle = payload.action === "pause" ? "paused" : "ready";
			return json(route, {
				api_version: "1",
				service_version: options.serviceVersion ?? "0.3.14",
				lifecycle,
			});
		}

		return json(
			route,
			{ error: { code: "FIXTURE_ROUTE_MISSING", recoverable: false } },
			404,
		);
	});

	return state;
}

export function failedJob(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return fixtureJob("failed", {
		stage: "failed",
		progress: { completed: 1, total: 2, unit: "tracks" },
		error: { code: "QWEN_ALIGNMENT_REQUIRED", recoverable: true },
		result_available: false,
		...overrides,
	});
}
