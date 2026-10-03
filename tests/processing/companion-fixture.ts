import type { Page, Route } from "@playwright/test";

export const LOCAL_API = "http://127.0.0.1:8765/api/v1";
export const UI_ORIGIN = "http://127.0.0.1:3102";
export const BROWSER_TOKEN = "browser_session_fixture_123456789012345678901234567890";

const sourceSha = "a".repeat(64);
export const CRAIG_SOURCE_ID = `craig-${sourceSha}`;
export const TRANSCRIPT_SHA = "b".repeat(64);

function compareSemver(left: string, right: string): number {
	const parse = (value: string) => {
		const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
		if (!match) throw new Error(`Invalid fixture SemVer: ${value}`);
		return match.slice(1).map(Number) as [number, number, number];
	};
	const a = parse(left);
	const b = parse(right);
	for (let index = 0; index < 3; index += 1) {
		if (a[index] !== b[index]) return a[index] - b[index];
	}
	return 0;
}

export type FixtureJobStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "interrupted";

export type FixtureSystemGpu = {
    uuid?: string | null;
    pciBusId?: string | null;
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
	jobEvents?: Record<string, unknown>[];
	expireBrowserSessionOnce?: boolean;
	profileReady?: boolean;
	benchmarkProfiles?: boolean;
	benchmarkReadyProfiles?: string[];
	benchmarkMinimumTrackDurationSeconds?: number | null;
	benchmarkSubmitError?: string | null;
	benchmarkPreparationFailureProfile?: string | null;
	benchmarkReadinessContract?: boolean;
	benchmarkEvidence?: boolean;
	whisperBenchmarkRuntimeUpgradeRequired?: boolean;
	reviewEnabled?: boolean;
	additionalCapabilities?: readonly string[];
	qwenRuntimeVersion?: string | null;
	qwenRuntimeUpgradeRequired?: boolean;
	qwenRuntimeStableVersion?: string | null;
	qwenRuntimeManifestUnavailable?: boolean;
	qwenRuntimeUpdateFailure?: string | null;
	qwenRuntimeUpdateInitiallyActive?: boolean;
	qwenRuntimeUpdateInitiallyCompleted?: boolean;
	advanceJobs?: boolean;
	ambiguousJobPostOnce?: boolean;
	jobReadDelayMs?: number;
	system?: FixtureSystemSnapshot;
};

export type CompanionFixtureState = {
	requests: { method: string; path: string; authorization?: string; idempotencyKey?: string }[];
	sessionCount: number;
	uploadCount: number;
	jobPostCount: number;
	preparationPostCount: number;
	preparationProfiles: string[];
	qwenRuntimeCheckPostCount: number;
	qwenRuntimeUpdatePostCount: number;
	qwenRuntimeStatusGetCount: number;
	idempotencyKeys: string[];
	jobStatusesServed: string[];
	job: Record<string, unknown> | null;
	setJob(job: Record<string, unknown> | null): void;
	setJobEvents(events: Record<string, unknown>[]): void;
	setLifecycle(value: "preparing" | "ready" | "paused"): void;
	setSystem(value: FixtureSystemSnapshot | undefined): void;
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


export function fixtureBenchmarkJob(
	status: FixtureJobStatus,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	const terminal = status === "succeeded";
	return {
		id: "benchmark-job-1",
		kind: "benchmark.craig",
		status,
		stage:
			status === "queued"
				? "queued"
				: status === "running"
					? "transcription"
					: status,
		progress:
			status === "queued"
				? { completed: 0, total: 4, unit: "profiles" }
				: status === "running"
					? { completed: 1, total: 4, unit: "profiles" }
					: { completed: 4, total: 4, unit: "profiles" },
		error:
			status === "failed"
				? { code: "BENCHMARK_PROFILE_FAILED", recoverable: true }
				: null,
		result_available: terminal,
		updated_at: "2026-09-20T18:00:00Z",
		attempt: 1,
		context: {
			campaign_id: "benchmark-local",
			session_id: "benchmark-local",
			source_id: CRAIG_SOURCE_ID,
			profiles: [
				"whisper-turbo",
				"whisper-detailed",
				"qwen-fast",
				"qwen-quality",
			],
			prepared: true,
		},
		...overrides,
	};
}

function fixtureBenchmarkTranscript(profileId: string): Record<string, unknown> {
	const changed = profileId === "qwen-fast";
	return {
		schema_version: "tda_transcript_v1",
		source_sha256: "a".repeat(64),
		engine: { profile: profileId },
		tracks: [
			{
				number: 1,
				speaker: "Alice",
				timeline_offset_seconds: 0,
				segments: [
					{ id: "s1", start: 10, end: 12, text: changed ? "olá planeta" : "olá mundo" },
				],
			},
			{
				number: 2,
				speaker: "Bob",
				timeline_offset_seconds: 0,
				segments: [{ id: "s2", start: 20, end: 22, text: "segundo texto" }],
			},
		],
	};
}

function fixtureBenchmarkQuality(revision: number): Record<string, unknown> {
	const row = (profileId: string, wer: number) => ({
		schema_version: "tda_benchmark_quality_receipt_v1",
		metric_implementation: "tda_asr_quality_metrics_v1",
		normalization_version: "tda_asr_text_normalization_v1",
		benchmark_id: "benchmark-evidence-1",
		sample_identity_sha256: "b".repeat(64),
		profile_id: profileId,
		transcript_sha256: "c".repeat(64),
		reference_revision: revision,
		reference_sha256: "e".repeat(64),
		reference_capability: "text",
		metrics_available: ["wer_normalized", "cer_normalized", "term_fidelity"],
		per_track: [],
		micro: {
			reference_words: 4,
			hypothesis_words: 4,
			substitutions: wer > 0 ? 1 : 0,
			deletions: 0,
			insertions: 0,
			wer_normalized: wer,
			reference_characters: 21,
			hypothesis_characters: 21,
			character_substitutions: wer > 0 ? 3 : 0,
			character_deletions: 0,
			character_insertions: 0,
			cer_normalized: wer > 0 ? 3 / 21 : 0,
		},
		term_fidelity: { reference_occurrences: 0, correct_occurrences: 0, term_recall: null, term_precision: null, terms: [] },
		timed: null,
		winner: null,
		computed_at: "2026-10-03T20:00:00Z",
	});
	return {
		"whisper-turbo": row("whisper-turbo", 0),
		"whisper-detailed": row("whisper-detailed", 0),
		"qwen-fast": row("qwen-fast", 0.25),
		"qwen-quality": row("qwen-quality", 0),
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
	let jobEvents = options.jobEvents ?? null;
	let prepared = options.profileReady ?? false;
	const benchmarkProfileIds = [
		"whisper-turbo",
		"whisper-detailed",
		"qwen-fast",
		"qwen-quality",
	] as const;
	const benchmarkPrepared = new Set<string>(
		options.benchmarkReadyProfiles ??
			(options.profileReady ? [...benchmarkProfileIds] : []),
	);
	let qwenRuntimeVersion = options.qwenRuntimeVersion === undefined ? "1.0.12" : options.qwenRuntimeVersion;
	const qwenStableVersion = options.qwenRuntimeStableVersion ?? "1.0.12";
	let qwenMaintenanceSequence = 0;
	let qwenRuntimeRecoveredFromInitialUpdate = false;
	let preparationReads = 0;
	let preparationStarted = false;
	let preparationProfile = "qwen-quality";
	let jobsReads = 0;
	let jobsGetCount = 0;
	let expired = false;
	let ambiguousJobPostConsumed = false;
	let submittedJob = false;
	let benchmarkReferenceRevision = 0;
	const state: CompanionFixtureState = {
		requests: [],
		sessionCount: 0,
		uploadCount: 0,
		jobPostCount: 0,
		preparationPostCount: 0,
		preparationProfiles: [],
		qwenRuntimeCheckPostCount: 0,
		qwenRuntimeUpdatePostCount: 0,
		qwenRuntimeStatusGetCount: 0,
		idempotencyKeys: [],
		jobStatusesServed: [],
		job: options.initialJobs?.[0] ?? null,
		setJob(value) {
			state.job = value;
			jobsReads = 0;
		},
		setJobEvents(value) {
			jobEvents = value;
		},
		setLifecycle(value) {
			lifecycle = value;
		},
		setSystem(value) {
			systemState = value;
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
			if (options.benchmarkProfiles) {
				const catalog = benchmarkProfileIds.map((id) => {
					const qwenRuntimeBlocked =
						options.qwenRuntimeUpgradeRequired === true && id.startsWith("qwen-");
					const whisperBenchmarkBlocked =
						options.whisperBenchmarkRuntimeUpgradeRequired === true &&
						id.startsWith("whisper-");
					const ready = qwenRuntimeBlocked ? false : benchmarkPrepared.has(id);
					const benchmarkReady = ready && !whisperBenchmarkBlocked;
					const benchmarkReason = benchmarkReady
						? null
						: qwenRuntimeBlocked
							? "QWEN_RUNTIME_REQUIRED"
							: whisperBenchmarkBlocked
								? "WHISPER_BENCHMARK_RUNTIME_REQUIRED"
								: "BENCHMARK_PROFILE_PREPARATION_REQUIRED";
					return {
						id,
						engine: id.startsWith("qwen-") ? "qwen3" : "whisper",
						ready,
						preparation_required: qwenRuntimeBlocked ? false : !ready,
						reason: ready
							? null
							: qwenRuntimeBlocked
								? "QWEN_RUNTIME_REQUIRED"
								: "BENCHMARK_PROFILE_PREPARATION_REQUIRED",
						benchmark_ready: benchmarkReady,
						benchmark_preparation_required:
							!benchmarkReady && !qwenRuntimeBlocked,
						benchmark_reason: benchmarkReason,
						...(id.startsWith("qwen-")
							? { runtime_version: qwenRuntimeVersion }
							: { runtime_version: whisperBenchmarkBlocked ? "1.1.5" : "1.1.7" }),
					};
				});
				return json(route, {
					capabilities: [
						...(options.reviewEnabled ? ["transcription.review"] : []),
						...(options.additionalCapabilities ?? []),
						"transcription.craig",
						"transcription.prepare",
						"transcription.prepare.cancel",
						...(options.benchmarkReadinessContract === false
							? []
							: ["processing.benchmark.runtime-readiness-v2"]),
						"runtime.qwen.check",
						"runtime.qwen.update",
						"job.events",
						"system.telemetry",
					],
					sync: false,
					device: { id: "fixture-pc", label: "PC sintético" },
					transcription: {
						profiles: benchmarkProfileIds.filter((id) =>
							options.qwenRuntimeUpgradeRequired === true && id.startsWith("qwen-")
								? false
								: benchmarkPrepared.has(id),
						),
						catalog,
						qwen_physical_gate: Object.fromEntries(
							(["qwen-fast", "qwen-quality"] as const).map((id) => {
								const runtimeBlocked = options.qwenRuntimeUpgradeRequired === true;
								return [
									id,
									!runtimeBlocked && benchmarkPrepared.has(id)
										? {
												status: "ready",
												ready: true,
												profile_id: id,
												runtime_version: qwenRuntimeVersion,
											}
										: {
												status: "missing",
												ready: false,
												profile_id: id,
												runtime_version: qwenRuntimeVersion,
												reason: runtimeBlocked
													? "QWEN_GATE_RUNTIME_NOT_READY"
													: "BENCHMARK_PROFILE_PREPARATION_REQUIRED",
											},
								];
							}),
						),
					},
				});
			}
			return json(route, {
				capabilities: [
					...(options.reviewEnabled ? ["transcription.review"] : []),
					...(options.additionalCapabilities ?? []),
					"transcription.craig",
					"transcription.prepare",
					"transcription.prepare.cancel",
					"job.events",
					"system.telemetry",
				],
				sync: false,
				device: { id: "fixture-pc", label: "PC sintético" },
				transcription: {
					profiles: prepared ? ["qwen-quality"] : [],
					catalog: [
						{
							id: "qwen-quality",
							engine: "qwen3",
							ready: prepared,
							preparation_required: !prepared,
							reason: prepared ? null : "QWEN_PHYSICAL_ACCEPTANCE_REQUIRED",
						},
					],
					qwen_physical_gate: {
						"qwen-quality": prepared
							? {
									status: "ready",
									ready: true,
									profile_id: "qwen-quality",
									runtime_version: qwenRuntimeVersion,
								}
							: {
									status: "missing",
									ready: false,
									profile_id: "qwen-quality",
									reason: "QWEN_PHYSICAL_ACCEPTANCE_REQUIRED",
								},
					},
				},
			});
		}
		if (path === "/qwen-runtime" && request.method() === "GET") {
			state.qwenRuntimeStatusGetCount += 1;
			qwenMaintenanceSequence += 1;
			if (
				options.qwenRuntimeUpdateInitiallyCompleted &&
				!qwenRuntimeRecoveredFromInitialUpdate
			) {
				if (qwenStableVersion) qwenRuntimeVersion = qwenStableVersion;
				benchmarkPrepared.add("qwen-fast");
				benchmarkPrepared.add("qwen-quality");
				options.qwenRuntimeUpgradeRequired = false;
				qwenRuntimeRecoveredFromInitialUpdate = true;
				return json(route, {
					schema: "tda_qwen_runtime_maintenance_v1",
					state: "completed",
					active: false,
					operation_id: "qwen-update-completed-fixture",
					mode: "update",
					stage: "complete",
					title: "Qwen Runtime atualizado.",
					detail: "A operação terminou antes da página observar o status.",
					sequence: qwenMaintenanceSequence,
					installed_status: "ready",
					installed_version: qwenRuntimeVersion,
					minimum_version: "1.0.12",
					stable_status: "compatible",
					stable_version: qwenStableVersion,
					stable_tag: qwenStableVersion
						? `companion-qwen-runtime-v${qwenStableVersion}`
						: null,
					stable_size: 1024,
					stable_part_count: 1,
					update_available: false,
					can_update: false,
					error_code: null,
				});
			}
			if (
				options.qwenRuntimeUpdateInitiallyActive &&
				!qwenRuntimeRecoveredFromInitialUpdate
			) {
				if (state.qwenRuntimeStatusGetCount === 1) {
					return json(route, {
						schema: "tda_qwen_runtime_maintenance_v1",
						state: "running",
						active: true,
						operation_id: "qwen-update-existing-fixture",
						mode: "update",
						stage: "downloading",
						title: "Baixando Qwen Runtime…",
						detail: "Operação iniciada antes desta página.",
						sequence: qwenMaintenanceSequence,
						installed_status: "ready",
						installed_version: qwenRuntimeVersion,
						minimum_version: "1.0.12",
						stable_status: "compatible",
						stable_version: qwenStableVersion,
						stable_tag: qwenStableVersion
							? `companion-qwen-runtime-v${qwenStableVersion}`
							: null,
						stable_size: 1024,
						stable_part_count: 1,
						update_available: true,
						can_update: false,
						error_code: null,
					});
				}
				if (qwenStableVersion) qwenRuntimeVersion = qwenStableVersion;
				benchmarkPrepared.add("qwen-fast");
				benchmarkPrepared.add("qwen-quality");
				options.qwenRuntimeUpgradeRequired = false;
				qwenRuntimeRecoveredFromInitialUpdate = true;
				return json(route, {
					schema: "tda_qwen_runtime_maintenance_v1",
					state: "completed",
					active: false,
					operation_id: "qwen-update-existing-fixture",
					mode: "update",
					stage: "complete",
					title: "Qwen Runtime atualizado.",
					detail: "Prontidão será recalculada pelo Companion.",
					sequence: qwenMaintenanceSequence,
					installed_status: "ready",
					installed_version: qwenRuntimeVersion,
					minimum_version: "1.0.12",
					stable_status: "compatible",
					stable_version: qwenStableVersion,
					stable_tag: qwenStableVersion
						? `companion-qwen-runtime-v${qwenStableVersion}`
						: null,
					stable_size: 1024,
					stable_part_count: 1,
					update_available: false,
					can_update: false,
					error_code: null,
				});
			}
			return json(route, {
				schema: "tda_qwen_runtime_maintenance_v1",
				state: options.qwenRuntimeUpdateFailure ? "failed" : "completed",
				active: false,
				operation_id: "qwen-runtime-fixture",
				mode: "check",
				stage: options.qwenRuntimeUpdateFailure ? "failed" : "complete",
				title: "Qwen Runtime verificado.",
				detail: "Fixture local.",
				sequence: qwenMaintenanceSequence,
				installed_status: "ready",
				installed_version: qwenRuntimeVersion,
				minimum_version: "1.0.12",
				stable_status: options.qwenRuntimeManifestUnavailable
					? "unavailable"
					: qwenStableVersion && compareSemver(qwenStableVersion, "1.0.12") >= 0
						? "compatible"
						: "below_minimum",
				stable_version: options.qwenRuntimeManifestUnavailable ? null : qwenStableVersion,
				stable_tag: options.qwenRuntimeManifestUnavailable || !qwenStableVersion
					? null
					: `companion-qwen-runtime-v${qwenStableVersion}`,
				stable_size: options.qwenRuntimeManifestUnavailable ? null : 1024,
				stable_part_count: options.qwenRuntimeManifestUnavailable ? null : 1,
				update_available:
					options.qwenRuntimeManifestUnavailable || !qwenStableVersion
						? null
						: (qwenRuntimeVersion === null ||
								compareSemver(qwenRuntimeVersion, qwenStableVersion) < 0) &&
							compareSemver(qwenStableVersion, "1.0.12") >= 0,
				can_update:
					!options.qwenRuntimeManifestUnavailable &&
					Boolean(qwenStableVersion) &&
					(qwenRuntimeVersion === null ||
						compareSemver(qwenRuntimeVersion, String(qwenStableVersion)) < 0) &&
					compareSemver(String(qwenStableVersion), "1.0.12") >= 0,
				error_code: options.qwenRuntimeManifestUnavailable
					? "NETWORK_UNAVAILABLE"
					: options.qwenRuntimeUpdateFailure ?? null,
			});
		}
		if (path === "/qwen-runtime/check" && request.method() === "POST") {
			state.qwenRuntimeCheckPostCount += 1;
			return json(route, {
				schema: "tda_qwen_runtime_maintenance_v1",
				state: "completed",
				active: false,
				operation_id: "qwen-check-fixture",
				mode: "check",
				stage: "complete",
				title: "Qwen Runtime verificado.",
				detail: "Fixture local.",
				sequence: ++qwenMaintenanceSequence,
				installed_status: "ready",
				installed_version: qwenRuntimeVersion,
				minimum_version: "1.0.12",
				stable_status: options.qwenRuntimeManifestUnavailable
					? "unavailable"
					: qwenStableVersion && compareSemver(qwenStableVersion, "1.0.12") >= 0
						? "compatible"
						: "below_minimum",
				stable_version: options.qwenRuntimeManifestUnavailable ? null : qwenStableVersion,
				stable_tag: options.qwenRuntimeManifestUnavailable || !qwenStableVersion ? null : `companion-qwen-runtime-v${qwenStableVersion}`,
				stable_size: options.qwenRuntimeManifestUnavailable ? null : 1024,
				stable_part_count: options.qwenRuntimeManifestUnavailable ? null : 1,
				update_available:
					options.qwenRuntimeManifestUnavailable || !qwenStableVersion
						? null
						: (qwenRuntimeVersion === null ||
								compareSemver(qwenRuntimeVersion, qwenStableVersion) < 0) &&
							compareSemver(qwenStableVersion, "1.0.12") >= 0,
				can_update:
					!options.qwenRuntimeManifestUnavailable &&
					Boolean(qwenStableVersion) &&
					(qwenRuntimeVersion === null ||
						compareSemver(qwenRuntimeVersion, String(qwenStableVersion)) < 0) &&
					compareSemver(String(qwenStableVersion), "1.0.12") >= 0,
				error_code: options.qwenRuntimeManifestUnavailable ? "NETWORK_UNAVAILABLE" : null,
			});
		}
		if (path === "/qwen-runtime/update" && request.method() === "POST") {
			state.qwenRuntimeUpdatePostCount += 1;
			if (options.qwenRuntimeUpdateFailure) {
				return json(route, {
					error: { code: options.qwenRuntimeUpdateFailure, recoverable: true },
				}, 409);
			}
			if (qwenStableVersion) qwenRuntimeVersion = qwenStableVersion;
			benchmarkPrepared.add("qwen-fast");
			benchmarkPrepared.add("qwen-quality");
			options.qwenRuntimeUpgradeRequired = false;
			return json(route, {
				schema: "tda_qwen_runtime_maintenance_v1",
				state: "completed",
				active: false,
				operation_id: "qwen-update-fixture",
				mode: "update",
				stage: "complete",
				title: "Qwen Runtime atualizado.",
				detail: "Prontidão será recalculada pelo Companion.",
				sequence: ++qwenMaintenanceSequence,
				installed_status: "ready",
				installed_version: qwenRuntimeVersion,
				minimum_version: "1.0.12",
				stable_status: "compatible",
				stable_version: qwenStableVersion,
				stable_tag: qwenStableVersion ? `companion-qwen-runtime-v${qwenStableVersion}` : null,
				stable_size: 1024,
				stable_part_count: 1,
				update_available: false,
				can_update: false,
				error_code: null,
			});
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
                    uuid: gpu.uuid ?? null,
                    pci_bus_id: gpu.pciBusId ?? null,
					name: gpu.name,
					utilization_percent: gpu.utilizationPercent,
					memory_used_bytes: gpu.memoryUsedBytes,
					memory_total_bytes: gpu.memoryTotalBytes,
				})),
			});
		}
		if (path === "/sources" && request.method() === "GET") {
			return json(route, { schema_version: "tda_craig_sources_v1", sources: [] });
		}
		if (path === "/sources/craig" && request.method() === "POST") {
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
				audio_work_seconds: 600,
				session_duration_seconds: 300,
				minimum_track_duration_seconds:
					options.benchmarkMinimumTrackDurationSeconds === undefined
						? 300
						: options.benchmarkMinimumTrackDurationSeconds,
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
			const row =
				payload && typeof payload === "object" && !Array.isArray(payload)
					? (payload as Record<string, unknown>)
					: null;
			const requestedProfile =
				row && typeof row.profile_id === "string" ? row.profile_id : null;
			if (
				!row ||
				row.source_id !== CRAIG_SOURCE_ID ||
				!requestedProfile ||
				(options.benchmarkProfiles
					? !benchmarkProfileIds.includes(
							requestedProfile as (typeof benchmarkProfileIds)[number],
						) || row.purpose !== "benchmark"
					: requestedProfile !== "qwen-quality")
			)
				return invalidRequest(route);
			preparationProfile = requestedProfile;
			state.preparationPostCount += 1;
			state.preparationProfiles.push(requestedProfile);
			preparationReads = 0;
			preparationStarted = true;
			return json(route, {
				schema: "tda_profile_preparation_v1",
				state: "running",
				active: true,
				operation_id: "c".repeat(32),
				source_id: CRAIG_SOURCE_ID,
				profile_id: requestedProfile,
				engine: requestedProfile.startsWith("qwen-") ? "qwen3" : "whisper",
				stage: requestedProfile.startsWith("qwen-") ? "qwen_probe" : "whisper_model",
				title: `Preparando ${requestedProfile}`,
				detail: "Fixture local",
				sequence: 1,
				elapsed_seconds: 0.1,
				error_code: null,
			});
		}
		if (path === "/preparation" && request.method() === "GET") {
			if (!preparationStarted) {
				return json(route, {
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
				});
			}
			preparationReads += 1;
			const failed =
				options.benchmarkProfiles &&
				options.benchmarkPreparationFailureProfile === preparationProfile;
			if (preparationReads >= 1 && !failed) {
				if (options.benchmarkProfiles) {
					benchmarkPrepared.add(preparationProfile);
					if (preparationProfile.startsWith("whisper-"))
						options.whisperBenchmarkRuntimeUpgradeRequired = false;
				} else prepared = true;
			}
			return json(route, {
				schema: "tda_profile_preparation_v1",
				state: failed ? "failed" : "completed",
				active: false,
				operation_id: "c".repeat(32),
				source_id: CRAIG_SOURCE_ID,
				profile_id: preparationProfile,
				engine: preparationProfile.startsWith("qwen-") ? "qwen3" : "whisper",
				stage: failed ? "failed" : "complete",
				title: failed ? "Preparação falhou" : `${preparationProfile} pronto`,
				detail: "",
				sequence: 2,
				elapsed_seconds: 0.2,
				error_code: failed ? "BENCHMARK_PREPARATION_FAILED" : null,
			});
		}
		if (path === "/jobs" && request.method() === "POST") {
			let payload: unknown;
			try {
				payload = request.postDataJSON();
			} catch {
				return invalidRequest(route);
			}
			if (!idempotencyKey || !/^[A-Za-z0-9_-]{1,128}$/u.test(idempotencyKey))
				return invalidRequest(route);
			const benchmarkRequest = exactObject(payload, {
				kind: "benchmark.craig",
				campaign_id: "benchmark-local",
				session_id: "benchmark-local",
				source_id: CRAIG_SOURCE_ID,
				glossary: "",
				context: "",
			});
			if (benchmarkRequest && options.benchmarkProfiles) {
				if (options.benchmarkSubmitError)
					return json(
						route,
						{
							error: {
								code: options.benchmarkSubmitError,
								recoverable: true,
							},
						},
						409,
					);
				state.jobPostCount += 1;
				state.idempotencyKeys.push(idempotencyKey);
				state.job = fixtureBenchmarkJob("queued");
				submittedJob = true;
				jobsReads = 0;
				return json(route, state.job);
			}
			if (
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
				const benchmark = state.job.kind === "benchmark.craig";
				if (jobsReads === 2)
					state.job = benchmark
						? fixtureBenchmarkJob("running")
						: fixtureJob("running");
				else if (jobsReads >= 3)
					state.job = benchmark
						? fixtureBenchmarkJob("succeeded")
						: fixtureJob("succeeded");
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
		if (path === "/jobs/benchmark-job-1/events") {
			return json(route, {
				events:
					options.jobEvents ??
					(state.job?.status === "running"
						? [
								{
									seq: 2,
									attempt: 1,
									code: "TRACK_STARTED",
									at: "2026-09-20T18:00:01Z",
									level: "info",
									data: {
										track: 1,
										total_tracks: 4,
										speaker: "Whisper Detailed",
									},
								},
							]
						: []),
			});
		}
		if (path === "/jobs/benchmark-job-1/result") {
			const profile = (profileId: string, engine: "whisper" | "qwen3") => ({
				kind: "benchmark.profile",
				schema_version: "tda_benchmark_profile_v1",
				profile_id: profileId,
				engine,
				model: "fixture-model",
				model_revision: "fixture-revision",
				device: "cuda",
				compute_type: "float16",
				alignment: "native",
				sample_seconds: 300,
				execution_mode: "prepared_artifacts_fresh_worker_per_profile_v1",
				audio_work_seconds: 600,
				session_duration_seconds: 300,
				processing_timing_version: "engine_processing_v1",
				processing_seconds: 30,
				rtf: 0.05,
				word_count: 100,
				segment_count: 10,
				track_count: 2,
				warning_count: 0,
				execution_lineage: {
					schema_version: "tda_execution_lineage_v1",
					companion_version: "0.3.18",
					runtime_family: engine === "whisper" ? "whisper" : "qwen",
					runtime_version: engine === "whisper" ? "1.1.7" : "1.0.12",
					runtime_artifact: {
						runtime_id: engine === "whisper" ? "whisper-ctranslate2" : "qwen3-transformers",
						version: engine === "whisper" ? "1.1.7" : "1.0.12",
						worker_sha256: "c".repeat(64),
						archive_sha256: "d".repeat(64),
					},
					device: "cuda:0",
					compute_type: "float16",
					gpu: {
						vendor: "NVIDIA",
						index: 0,
						model: "NVIDIA GeForce RTX 4070 Laptop GPU",
						vram_total_bytes: 8 * 1024 * 1024 * 1024,
						compute_capability: "8.9",
						driver_version: "synthetic",
					},
				},
			});
			return json(route, {
				schema_version: "tda_processing_benchmark_v1",
				kind: "benchmark.craig",
				job_id: "benchmark-job-1",
				source_id: CRAIG_SOURCE_ID,
				campaign_id: "benchmark-local",
				session_id: "benchmark-local",
				sample_identity_sha256: "b".repeat(64),
				sample_seconds: 300,
				execution_mode: "prepared_artifacts_fresh_worker_per_profile_v1",
				...(options.benchmarkEvidence
					? {
						benchmark_id: "benchmark-evidence-1",
						evidence_schema_version: "tda_benchmark_bundle_v1",
					}
					: {}),
				track_count: 2,
				audio_work_seconds: 600,
				prepared: true,
				profiles: [
					profile("whisper-turbo", "whisper"),
					profile("whisper-detailed", "whisper"),
					profile("qwen-fast", "qwen3"),
					profile("qwen-quality", "qwen3"),
				],
			});
		}
		if (options.benchmarkEvidence && path === "/benchmarks/benchmark-evidence-1/reference") {
			const reference = {
				schema_version: "tda_benchmark_reference_v1",
				benchmark_id: "benchmark-evidence-1",
				source_sha256: "a".repeat(64),
				sample_identity_sha256: "b".repeat(64),
				sample: { start_seconds: 0, end_seconds: 300 },
				revision: benchmarkReferenceRevision,
				parent_revision: benchmarkReferenceRevision > 1 ? benchmarkReferenceRevision - 1 : null,
				provenance: "manual",
				seed_profile_id: null,
				capability: "text",
				normalization_version: "tda_asr_text_normalization_v1",
				tracks: [
					{ track_number: 1, speaker: "Alice", text: "olá mundo" },
					{ track_number: 2, speaker: "Bob", text: "segundo texto" },
				],
				terms: [],
				created_at: "2026-10-03T20:00:00Z",
				payload_sha256: "e".repeat(64),
			};
			if (request.method() === "GET") {
				if (benchmarkReferenceRevision === 0)
					return json(route, { error: { code: "BENCHMARK_REFERENCE_NOT_FOUND", recoverable: false } }, 404);
				return json(route, reference);
			}
			if (request.method() === "POST") {
				let payload: Record<string, unknown>;
				try {
					payload = request.postDataJSON() as Record<string, unknown>;
				} catch {
					return invalidRequest(route);
				}
				if (payload.sample_identity_sha256 !== "b".repeat(64))
					return json(route, { error: { code: "REFERENCE_SAMPLE_MISMATCH", recoverable: false } }, 409);
				benchmarkReferenceRevision += 1;
				const saved = { ...reference, revision: benchmarkReferenceRevision };
				return json(route, { reference: saved, quality: fixtureBenchmarkQuality(benchmarkReferenceRevision) });
			}
		}
		if (options.benchmarkEvidence && path === "/benchmarks/benchmark-evidence-1/quality") {
			if (benchmarkReferenceRevision === 0)
				return json(route, { error: { code: "BENCHMARK_REFERENCE_NOT_FOUND", recoverable: false } }, 404);
			return json(route, { profiles: fixtureBenchmarkQuality(benchmarkReferenceRevision) });
		}
		if (options.benchmarkEvidence && /^\/benchmarks\/benchmark-evidence-1\/profiles\/(whisper-turbo|whisper-detailed|qwen-fast|qwen-quality)\/transcript$/u.test(path)) {
			const profileId = path.split("/")[4];
			return json(route, fixtureBenchmarkTranscript(profileId));
		}
		if (
			path === "/jobs/benchmark-job-1/cancel" &&
			request.method() === "POST"
		) {
			state.job = fixtureBenchmarkJob("cancelled");
			return json(route, state.job);
		}
		if (path === "/jobs/craig-job-1/events") {
			return json(route, {
				events:
					jobEvents ??
					(state.job?.status === "running"
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
										start_seconds: 0,
										end_seconds: 30,
									},
								},
							]
						: []),
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
