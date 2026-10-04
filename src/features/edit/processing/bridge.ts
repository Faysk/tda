import {
	AUTOMATIC_LOOPBACK_SESSION_MINIMUM_VERSION,
	supportsAutomaticLoopbackSession,
} from "./compatibility";
import {
	BridgeError,
	type LocalReview,
	type CraigBenchmarkInput,
	type CraigTranscriptionInput,
	type LocalReviewSegment,
	type LocalReviewStatus,
	benchmarkIdentifier,
	identifier,
	LOCAL_API,
	parseBenchmarkAttemptResult,
	parseBenchmarkEvidenceSummary,
	parseBenchmarkResult,
	parseBenchmarkTranscriptSnapshot,
	parseCapabilities,
	parseCraigSource,
	parseHealth,
	parseJob,
	parseJobActivity,
	parsePreparationStatus,
	parseQwenRuntimeMaintenanceStatus,
	record,
	text,
	parseJobEventPage,
	parseJobListPage,
	parseJobs,
	parseLocalReview,
	parseLocalRunCatalogPage,
	parseLocalRunDeleteReceipt,
	parseLocalRuns,
	parseLocalSources,
	parseResultSummary,
	parseSessionParticipantMapping,
	parseSessionTranscriptionIntent,
	parseSessionWorkspace,
	parseSystemSnapshot,
	runIdentifier,
} from "./protocol";
import {
	buildCraigTranscriptionRequest,
	LOCAL_JSON_BODY_MAX_BYTES,
	serializedJsonBody,
} from "./request-budget";
import {
	parseSessionAssembly,
	parseSessionAssemblyList,
	parseSessionAssemblyReviewSummary,
	type SessionAssemblyReviewSegment,
	type SessionAssemblyReviewSummary,
} from "./session-composer-protocol";
import {
	type BenchmarkReferenceSaveInput,
	parseBenchmarkQualityInspection,
	parseBenchmarkQualitySummary,
	parseBenchmarkReference,
	parseBenchmarkReferenceDraft,
	parseBenchmarkReferenceResponse,
	parseBenchmarkReferenceStatus,
	serializeBenchmarkReferenceSave,
} from "./benchmark-quality-protocol";

const LOCAL_REVIEW_BODY_MAX_BYTES = 32 * 1024 * 1024;
const LOCAL_BENCHMARK_REFERENCE_BODY_MAX_BYTES = 16 * 1024 * 1024;
const LOCAL_BENCHMARK_REFERENCE_RESPONSE_MAX_BYTES = 32 * 1024 * 1024;
const BENCHMARK_ID_PATTERN = /^benchmark-[A-Za-z0-9_-]{1,128}-a[1-9][0-9]{0,5}$/u;

type PairingMode = "none" | "legacy" | "browser";

let pairedToken = "";
let pairingMode: PairingMode = "none";
const pairingListeners = new Set<() => void>();

function notifyPairing() {
	for (const listener of pairingListeners) listener();
}

export function localBridgePaired(): boolean {
	return pairedToken.length > 0;
}

export function subscribeLocalBridgePairing(listener: () => void) {
	pairingListeners.add(listener);
	return () => pairingListeners.delete(listener);
}

function mapStatus(status: number, serverCode: string | null = null): BridgeError {
	return new BridgeError(
		status === 401
			? "unauthorized"
			: status === 403
				? "forbidden"
				: status === 409
					? "conflict"
					: "service_error",
		serverCode,
	);
}

function sanitizedServerCode(value: unknown): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const error = (value as Record<string, unknown>).error;
	if (!error || typeof error !== "object" || Array.isArray(error)) return null;
	const code = (error as Record<string, unknown>).code;
	return typeof code === "string" && /^[A-Z0-9_]{1,96}$/u.test(code)
		? code
		: null;
}

export class LocalBridge {
	constructor(
		private readonly request: typeof fetch = (input, init) =>
			fetch(input, init),
	) {}

	private setPairing(token: string, mode: Exclude<PairingMode, "none">) {
		if (!/^[A-Za-z0-9_-]{32,256}$/u.test(token))
			throw new BridgeError("unauthorized");
		pairedToken = token;
		pairingMode = mode;
		notifyPairing();
	}

	pair(token: string) {
		this.setPairing(token, "legacy");
	}

	async bootstrap(signal: AbortSignal) {
		// Health is intentionally public so we confirm the expected loopback
		// protocol before asking the local Agent for a browser-scoped credential.
		const health = await this.health(signal);
		if (!supportsAutomaticLoopbackSession(health.service_version))
			throw new BridgeError("version_incompatible", null, {
				detectedServiceVersion: health.service_version,
				minimumServiceVersion: AUTOMATIC_LOOPBACK_SESSION_MINIMUM_VERSION,
			});
		const value = record(
			await this.json("/session", signal, {}, undefined, true),
		);
		if (value.schema !== "tda_loopback_session_v1")
			throw new BridgeError("session_incompatible", null, {
				detectedServiceVersion: health.service_version,
				minimumServiceVersion: AUTOMATIC_LOOPBACK_SESSION_MINIMUM_VERSION,
			});
		const token = text(value.token, 256);
		if (!/^[A-Za-z0-9_-]{32,256}$/u.test(token))
			throw new BridgeError("invalid_response");
		if (
			typeof value.expires_in_seconds !== "number" ||
			!Number.isSafeInteger(value.expires_in_seconds) ||
			value.expires_in_seconds < 60
		)
			throw new BridgeError("invalid_response");
		this.setPairing(token, "browser");
	}

	disconnect() {
		if (!pairedToken && pairingMode === "none") return;
		pairedToken = "";
		pairingMode = "none";
		notifyPairing();
	}

	private token() {
		if (!pairedToken) throw new BridgeError("unauthorized");
		return pairedToken;
	}

	private async responseJson(response: Response, maxBytes = 1024 * 1024) {
		const isJson =
			response.headers.get("content-type")?.includes("application/json") ?? false;
		const reader = response.body?.getReader();
		if (!reader) {
			if (!response.ok) throw mapStatus(response.status);
			throw new BridgeError("invalid_response");
		}

		let size = 0;
		let data = "";
		const decoder = new TextDecoder();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > maxBytes) {
					await reader.cancel();
					if (!response.ok) throw mapStatus(response.status);
					throw new BridgeError("invalid_response");
				}
				if (isJson) data += decoder.decode(value, { stream: true });
			}
		} finally {
			reader.releaseLock();
		}

		if (!isJson) {
			if (!response.ok) throw mapStatus(response.status);
			throw new BridgeError("invalid_response");
		}

		let value: unknown;
		try {
			value = JSON.parse(data + decoder.decode()) as unknown;
		} catch {
			if (!response.ok) throw mapStatus(response.status);
			throw new BridgeError("invalid_response");
		}
		if (!response.ok)
			throw mapStatus(response.status, sanitizedServerCode(value));
		return value;
	}

	private async json(
		path: string,
		signal: AbortSignal,
		body?: unknown,
		key?: string,
		publicRequest = false,
	) {
		let timedOut = false;
		const requestOnce = async () => {
			const timeout = AbortSignal.timeout(8000);
			const headers: Record<string, string> = { Accept: "application/json" };
			if (!publicRequest) headers.Authorization = `Bearer ${this.token()}`;
			const serialized = body === undefined ? null : serializedJsonBody(body);
			if (serialized && serialized.byteLength > LOCAL_JSON_BODY_MAX_BYTES)
				throw new BridgeError("payload_too_large");
			if (serialized) headers["Content-Type"] = "application/json";
			if (key) headers["Idempotency-Key"] = identifier(key);
			try {
				const response = await this.request(`${LOCAL_API}${path}`, {
					method: serialized === null ? "GET" : "POST",
					headers,
					body: serialized?.body,
					mode: "cors",
					credentials: "omit",
					redirect: "error",
					cache: "no-store",
					referrerPolicy: "no-referrer",
					signal: AbortSignal.any([signal, timeout]),
				});
				return await this.responseJson(response);
			} catch (error) {
				if (timeout.aborted && !signal.aborted) timedOut = true;
				throw error;
			}
		};

		try {
			return await requestOnce();
		} catch (error) {
			if (
				error instanceof BridgeError &&
				error.code === "unauthorized" &&
				!publicRequest &&
				pairingMode === "browser" &&
				!signal.aborted
			) {
				await this.bootstrap(signal);
				timedOut = false;
				return await requestOnce();
			}
			if (error instanceof BridgeError) throw error;
			throw new BridgeError(timedOut ? "timeout" : "unreachable");
		}
	}

	private async benchmarkReferenceJson(
		path: string,
		signal: AbortSignal,
		body?: unknown,
	) {
		let timedOut = false;
		const requestOnce = async () => {
			const timeout = AbortSignal.timeout(30_000);
			const serialized = body === undefined ? null : serializedJsonBody(body);
			if (
				serialized &&
				serialized.byteLength > LOCAL_BENCHMARK_REFERENCE_BODY_MAX_BYTES
			)
				throw new BridgeError("payload_too_large");
			const headers: Record<string, string> = {
				Accept: "application/json",
				Authorization: `Bearer ${this.token()}`,
			};
			if (serialized) headers["Content-Type"] = "application/json";
			try {
				const response = await this.request(`${LOCAL_API}${path}`, {
					method: serialized === null ? "GET" : "POST",
					headers,
					body: serialized?.body,
					mode: "cors",
					credentials: "omit",
					redirect: "error",
					cache: "no-store",
					referrerPolicy: "no-referrer",
					signal: AbortSignal.any([signal, timeout]),
				});
				return await this.responseJson(
					response,
					LOCAL_BENCHMARK_REFERENCE_RESPONSE_MAX_BYTES,
				);
			} catch (error) {
				if (timeout.aborted && !signal.aborted) timedOut = true;
				throw error;
			}
		};
		try {
			return await requestOnce();
		} catch (error) {
			if (
				error instanceof BridgeError &&
				error.code === "unauthorized" &&
				pairingMode === "browser" &&
				!signal.aborted
			) {
				await this.bootstrap(signal);
				timedOut = false;
				return await requestOnce();
			}
			if (error instanceof BridgeError) throw error;
			throw new BridgeError(timedOut ? "timeout" : "unreachable");
		}
	}

	private async reviewJson(
		path: string,
		signal: AbortSignal,
		body?: unknown,
	) {
		let timedOut = false;
		const requestOnce = async () => {
			const timeout = AbortSignal.timeout(30_000);
			const serialized = body === undefined ? null : serializedJsonBody(body);
			if (serialized && serialized.byteLength > LOCAL_REVIEW_BODY_MAX_BYTES)
				throw new BridgeError("payload_too_large");
			const headers: Record<string, string> = {
				Accept: "application/json",
				Authorization: `Bearer ${this.token()}`,
			};
			if (serialized) headers["Content-Type"] = "application/json";
			try {
				const response = await this.request(`${LOCAL_API}${path}`, {
					method: serialized === null ? "GET" : "POST",
					headers,
					body: serialized?.body,
					mode: "cors",
					credentials: "omit",
					redirect: "error",
					cache: "no-store",
					referrerPolicy: "no-referrer",
					signal: AbortSignal.any([signal, timeout]),
				});
				return await this.responseJson(response, LOCAL_REVIEW_BODY_MAX_BYTES);
			} catch (error) {
				if (timeout.aborted && !signal.aborted) timedOut = true;
				throw error;
			}
		};
		try {
			return await requestOnce();
		} catch (error) {
			if (
				error instanceof BridgeError &&
				error.code === "unauthorized" &&
				pairingMode === "browser" &&
				!signal.aborted
			) {
				await this.bootstrap(signal);
				timedOut = false;
				return await requestOnce();
			}
			if (error instanceof BridgeError) throw error;
			throw new BridgeError(timedOut ? "timeout" : "unreachable");
		}
	}

	private async raw(
		path: string,
		signal: AbortSignal,
		accept = "*/*",
	) {
		let timedOut = false;
		const requestOnce = async () => {
			const timeout = AbortSignal.timeout(120_000);
			try {
				const response = await this.request(`${LOCAL_API}${path}`, {
					method: "GET",
					headers: {
						Accept: accept,
						Authorization: `Bearer ${this.token()}`,
					},
					mode: "cors",
					credentials: "omit",
					redirect: "error",
					cache: "no-store",
					referrerPolicy: "no-referrer",
					signal: AbortSignal.any([signal, timeout]),
				});
				if (!response.ok) {
					const contentType = response.headers.get("content-type") ?? "";
					if (contentType.includes("application/json"))
						await this.responseJson(response, LOCAL_REVIEW_BODY_MAX_BYTES);
					throw mapStatus(response.status);
				}
				return response;
			} catch (error) {
				if (timeout.aborted && !signal.aborted) timedOut = true;
				throw error;
			}
		};
		try {
			return await requestOnce();
		} catch (error) {
			if (
				error instanceof BridgeError &&
				error.code === "unauthorized" &&
				pairingMode === "browser" &&
				!signal.aborted
			) {
				await this.bootstrap(signal);
				timedOut = false;
				return await requestOnce();
			}
			if (error instanceof BridgeError) throw error;
			throw new BridgeError(timedOut ? "timeout" : "unreachable");
		}
	}

	async health(signal: AbortSignal) {
		return parseHealth(
			await this.json("/health", signal, undefined, undefined, true),
		);
	}
	async capabilities(signal: AbortSignal) {
		return parseCapabilities(await this.json("/capabilities", signal));
	}
	async sessionWorkspace(
		campaignId: string,
		sessionId: string,
		signal: AbortSignal,
	) {
		return parseSessionWorkspace(
			await this.json(
				`/session-workspaces/${identifier(campaignId)}/${identifier(sessionId)}`,
				signal,
			),
		);
	}
	async ensureSessionWorkspace(
		campaignId: string,
		sessionId: string,
		signal: AbortSignal,
	) {
		return parseSessionWorkspace(
			await this.json(
				`/session-workspaces/${identifier(campaignId)}/${identifier(sessionId)}`,
				signal,
				{},
			),
		);
	}
	async sessionTranscriptionIntent(
		campaignId: string,
		sessionId: string,
		signal: AbortSignal,
	) {
		return parseSessionTranscriptionIntent(
			await this.json(
				`/session-workspaces/${identifier(campaignId)}/${identifier(sessionId)}/intent`,
				signal,
			),
		);
	}
	async saveSessionTranscriptionIntent(
		campaignId: string,
		sessionId: string,
		input: Readonly<{
			requestId: string;
			profileId: CraigTranscriptionInput["profileId"];
			context: string;
			glossary: string;
		}>,
		signal: AbortSignal,
	) {
		return parseSessionTranscriptionIntent(
			await this.json(
				`/session-workspaces/${identifier(campaignId)}/${identifier(sessionId)}/intent`,
				signal,
				{
					request_id: identifier(input.requestId),
					profile_id: input.profileId,
					context: input.context,
					glossary: input.glossary,
				},
			),
		);
	}
	async attachSessionSource(
		campaignId: string,
		sessionId: string,
		sourceId: string,
		expectedRevision: number,
		signal: AbortSignal,
	) {
		return parseSessionWorkspace(
			await this.json(
				`/session-workspaces/${identifier(campaignId)}/${identifier(sessionId)}/parts`,
				signal,
				{
					source_id: identifier(sourceId),
					expected_revision: expectedRevision,
				},
			),
		);
	}
	async detachSessionPart(
		campaignId: string,
		sessionId: string,
		partId: string,
		expectedRevision: number,
		signal: AbortSignal,
	) {
		return parseSessionWorkspace(
			await this.json(
				`/session-workspaces/${identifier(campaignId)}/${identifier(sessionId)}/parts/detach`,
				signal,
				{
					part_id: identifier(partId),
					expected_revision: expectedRevision,
				},
			),
		);
	}
	async reorderSessionParts(
		campaignId: string,
		sessionId: string,
		partIds: readonly string[],
		expectedRevision: number,
		signal: AbortSignal,
	) {
		return parseSessionWorkspace(
			await this.json(
				`/session-workspaces/${identifier(campaignId)}/${identifier(sessionId)}/parts/reorder`,
				signal,
				{
					part_ids: partIds.map(identifier),
					expected_revision: expectedRevision,
				},
			),
		);
	}
	async confirmSessionSequence(
		campaignId: string,
		sessionId: string,
		expectedRevision: number,
		signal: AbortSignal,
	) {
		return parseSessionWorkspace(
			await this.json(
				`/session-workspaces/${identifier(campaignId)}/${identifier(sessionId)}/timeline/confirm-sequence`,
				signal,
				{ expected_revision: expectedRevision },
			),
		);
	}
	async deriveSessionTimeline(
		campaignId: string,
		sessionId: string,
		expectedRevision: number,
		signal: AbortSignal,
	) {
		return parseSessionWorkspace(
			await this.json(
				`/session-workspaces/${identifier(campaignId)}/${identifier(sessionId)}/timeline/derive`,
				signal,
				{ expected_revision: expectedRevision },
			),
		);
	}
	async updateSessionPartTiming(
		campaignId: string,
		sessionId: string,
		input: Readonly<{
			partId: string;
			expectedRevision: number;
			sessionOffsetSeconds: number;
			trimStartSeconds?: number;
			trimEndSeconds?: number | null;
			gapConfirmed?: boolean;
			overlapResolution?:
				| "prefer_earlier_until"
				| "prefer_later_from"
				| null;
			overlapBoundarySeconds?: number | null;
		}>,
		signal: AbortSignal,
	) {
		return parseSessionWorkspace(
			await this.json(
				`/session-workspaces/${identifier(campaignId)}/${identifier(sessionId)}/parts/timing`,
				signal,
				{
					part_id: identifier(input.partId),
					expected_revision: input.expectedRevision,
					session_offset_seconds: input.sessionOffsetSeconds,
					trim_start_seconds: input.trimStartSeconds ?? 0,
					trim_end_seconds: input.trimEndSeconds ?? null,
					gap_confirmed: input.gapConfirmed ?? false,
					overlap_resolution: input.overlapResolution ?? null,
					overlap_boundary_seconds:
						input.overlapBoundarySeconds ?? null,
				},
			),
		);
	}
	async sessionParticipants(
		campaignId: string,
		sessionId: string,
		signal: AbortSignal,
	) {
		return parseSessionParticipantMapping(
			await this.json(
				`/session-workspaces/${identifier(campaignId)}/${identifier(sessionId)}/participants`,
				signal,
			),
		);
	}
	async updateSessionParticipants(
		campaignId: string,
		sessionId: string,
		expectedRevision: number,
		assignments: readonly Readonly<{
			observationId: string;
			participantId: string;
		}>[],
		signal: AbortSignal,
	) {
		return parseSessionParticipantMapping(
			await this.json(
				`/session-workspaces/${identifier(campaignId)}/${identifier(sessionId)}/participants`,
				signal,
				{
					expected_revision: expectedRevision,
					assignments: assignments.map((assignment) => ({
						observation_id: identifier(assignment.observationId),
						participant_id: identifier(assignment.participantId),
					})),
				},
			),
		);
	}
	async selectSessionPartRun(
		campaignId: string,
		sessionId: string,
		partId: string,
		runId: string,
		expectedRevision: number,
		signal: AbortSignal,
	) {
		return parseSessionWorkspace(
			await this.json(
				"/session-workspaces/" +
					identifier(campaignId) +
					"/" +
					identifier(sessionId) +
					"/parts/run",
				signal,
				{
					part_id: identifier(partId),
					run_id: runIdentifier(runId),
					expected_revision: expectedRevision,
				},
			),
		);
	}

	async sessionAssemblies(
		campaignId: string,
		sessionId: string,
		signal: AbortSignal,
	) {
		return parseSessionAssemblyList(
			await this.json(
				"/session-workspaces/" +
					identifier(campaignId) +
					"/" +
					identifier(sessionId) +
					"/assemblies",
				signal,
			),
		);
	}

	async buildSessionAssembly(
		campaignId: string,
		sessionId: string,
		expectedRevision: number,
		signal: AbortSignal,
	) {
		return parseSessionAssembly(
			await this.json(
				"/session-workspaces/" +
					identifier(campaignId) +
					"/" +
					identifier(sessionId) +
					"/assemblies",
				signal,
				{ expected_revision: expectedRevision },
			),
		);
	}

	async sessionAssemblyReviewBase(
		campaignId: string,
		sessionId: string,
		assemblyId: string,
		signal: AbortSignal,
	) {
		if (!/^[0-9a-f]{64}$/u.test(assemblyId))
			throw new BridgeError("invalid_response");
		return parseSessionAssemblyReviewSummary(
			await this.reviewJson(
				"/session-workspaces/" +
					identifier(campaignId) +
					"/" +
					identifier(sessionId) +
					"/assemblies/" +
					assemblyId +
					"/review/base",
				signal,
			),
			assemblyId,
		);
	}

	async sessionAssemblyReview(
		campaignId: string,
		sessionId: string,
		assemblyId: string,
		signal: AbortSignal,
	) {
		if (!/^[0-9a-f]{64}$/u.test(assemblyId))
			throw new BridgeError("invalid_response");
		return parseSessionAssemblyReviewSummary(
			await this.reviewJson(
				"/session-workspaces/" +
					identifier(campaignId) +
					"/" +
					identifier(sessionId) +
					"/assemblies/" +
					assemblyId +
					"/review",
				signal,
			),
			assemblyId,
		);
	}

	async saveSessionAssemblyReview(
		campaignId: string,
		sessionId: string,
		assemblyId: string,
		baseline: SessionAssemblyReviewSummary,
		status: LocalReviewStatus,
		segments: readonly SessionAssemblyReviewSegment[],
		signal: AbortSignal,
	) {
		if (!/^[0-9a-f]{64}$/u.test(assemblyId) || baseline.assemblyId !== assemblyId)
			throw new BridgeError("conflict", "SESSION_ASSEMBLY_REVIEW_DRAFT_CONFLICT");
		const expected =
			baseline.persistence === "ephemeral_base"
				? {
						persistence: "ephemeral_base",
						base_transcript_sha256: baseline.baseTranscriptSha256,
					}
				: {
						persistence: "persisted",
						draft_revision: baseline.draftRevision,
						draft_sha256: baseline.draftSha256,
					};
		return parseSessionAssemblyReviewSummary(
			await this.reviewJson(
				"/session-workspaces/" +
					identifier(campaignId) +
					"/" +
					identifier(sessionId) +
					"/assemblies/" +
					assemblyId +
					"/review",
				signal,
				{
					snapshot_contract: "tda_session_assembly_review_cas_v1",
					expected,
					status,
					segments: segments.map((segment) => ({
						assembly_segment_id: segment.assemblySegmentId,
						part_id: segment.partId,
						source_id: segment.sourceId,
						run_id: segment.runId,
						source_segment_id: segment.sourceSegmentId,
						track_number: segment.trackNumber,
						participant_id: segment.participantId,
						start: segment.start,
						end: segment.end,
						...(segment.absoluteTime === undefined
							? {}
							: segment.absoluteTime
								? {
										absolute_time_state: "trusted_absolute",
										absolute_start: segment.absoluteTime.startIso,
										absolute_end: segment.absoluteTime.endIso,
										absolute_time_source: segment.absoluteTime.source,
									}
								: {
										absolute_time_state: "unavailable",
										absolute_start: null,
										absolute_end: null,
										absolute_time_source: null,
									}),
						text: segment.text,
						speaker: segment.speaker,
						reviewed: segment.reviewed,
					})),
				},
			),
			assemblyId,
		);
	}

	async qwenRuntimeStatus(signal: AbortSignal) {
		return parseQwenRuntimeMaintenanceStatus(
			await this.json("/qwen-runtime", signal),
		);
	}
	async checkQwenRuntime(signal: AbortSignal) {
		return parseQwenRuntimeMaintenanceStatus(
			await this.json("/qwen-runtime/check", signal, {}),
		);
	}
	async updateQwenRuntime(signal: AbortSignal) {
		return parseQwenRuntimeMaintenanceStatus(
			await this.json("/qwen-runtime/update", signal, {}),
		);
	}

	async preparation(signal: AbortSignal) {
		return parsePreparationStatus(await this.json("/preparation", signal));
	}
	async prepareProfile(
		sourceId: string,
		profileId: CraigTranscriptionInput["profileId"],
		signal: AbortSignal,
		purpose: "transcription" | "benchmark" = "transcription",
	) {
		return parsePreparationStatus(
			await this.json("/preparation", signal, {
				source_id: identifier(sourceId),
				profile_id: profileId,
				...(purpose === "benchmark" ? { purpose } : {}),
			}),
		);
	}
	async cancelPreparation(operationId: string, signal: AbortSignal) {
		if (!/^[0-9a-f]{32}$/u.test(operationId))
			throw new BridgeError("invalid_response");
		return parsePreparationStatus(
			await this.json("/preparation/cancel", signal, {
				expected_operation_id: operationId,
			}),
		);
	}
	async jobs(signal: AbortSignal) {
		return parseJobs(await this.json("/jobs", signal));
	}
	async jobPage(
		scope: "all" | "active" | "history",
		signal: AbortSignal,
		options: Readonly<{ cursor?: string; limit?: number }> = {},
	) {
		const params = new URLSearchParams({ scope });
		if (options.cursor !== undefined) params.set("cursor", options.cursor);
		if (options.limit !== undefined) params.set("limit", String(options.limit));
		return parseJobListPage(
			await this.json(`/jobs?${params.toString()}`, signal),
		);
	}
	async job(id: string, signal: AbortSignal) {
		return parseJob(await this.json(`/jobs/${identifier(id)}`, signal));
	}
	async activity(id: string, signal: AbortSignal, attempt?: number) {
		if (
			attempt !== undefined &&
			(!Number.isSafeInteger(attempt) || attempt < 1)
		)
			throw new BridgeError("invalid_response");
		const query = attempt === undefined ? "" : `?attempt=${attempt}`;
		return parseJobActivity(
			await this.json(`/jobs/${identifier(id)}/activity${query}`, signal),
		);
	}
	async events(
		id: string,
		signal: AbortSignal,
		options: Readonly<{
			afterSeq?: number;
			beforeSeq?: number;
			limit?: number;
		}> = {},
	) {
		const params = new URLSearchParams();
		if (options.afterSeq !== undefined)
			params.set("after_seq", String(options.afterSeq));
		if (options.beforeSeq !== undefined)
			params.set("before_seq", String(options.beforeSeq));
		if (options.limit !== undefined) params.set("limit", String(options.limit));
		const query = params.size > 0 ? `?${params.toString()}` : "";
		return parseJobEventPage(
			await this.json(`/jobs/${identifier(id)}/events${query}`, signal),
		);
	}
	async system(signal: AbortSignal) {
		return parseSystemSnapshot(await this.json("/system", signal));
	}
	async lifecycle(action: "pause" | "resume", signal: AbortSignal) {
		return parseHealth(await this.json("/lifecycle", signal, { action }));
	}
	async jobAction(id: string, action: "cancel" | "retry", signal: AbortSignal) {
		return parseJob(
			await this.json(`/jobs/${identifier(id)}/${action}`, signal, {}),
		);
	}
	async deleteJob(id: string, signal: AbortSignal) {
		await this.json(`/jobs/${identifier(id)}/delete`, signal, {});
	}
	async craigSource(file: File, signal: AbortSignal) {
		if (!(file instanceof Blob) || file.size <= 0)
			throw new BridgeError("invalid_response");
		let timedOut = false;
		const uploadOnce = async () => {
			const timeout = AbortSignal.timeout(15 * 60 * 1000);
			try {
				const response = await this.request(`${LOCAL_API}/sources/craig`, {
					method: "POST",
					headers: {
						Accept: "application/json",
						Authorization: `Bearer ${this.token()}`,
						"Content-Type": "application/zip",
					},
					body: file,
					mode: "cors",
					credentials: "omit",
					redirect: "error",
					cache: "no-store",
					referrerPolicy: "no-referrer",
					signal: AbortSignal.any([signal, timeout]),
				});
				return parseCraigSource(await this.responseJson(response));
			} catch (error) {
				if (timeout.aborted && !signal.aborted) timedOut = true;
				throw error;
			}
		};
		try {
			return await uploadOnce();
		} catch (error) {
			if (
				error instanceof BridgeError &&
				error.code === "unauthorized" &&
				pairingMode === "browser" &&
				!signal.aborted
			) {
				await this.bootstrap(signal);
				timedOut = false;
				return await uploadOnce();
			}
			if (error instanceof BridgeError) throw error;
			throw new BridgeError(timedOut ? "timeout" : "unreachable");
		}
	}
	async benchmark(input: CraigBenchmarkInput, key: string, signal: AbortSignal) {
		return parseJob(
			await this.json(
				"/jobs",
				signal,
				{
					kind: "benchmark.craig",
					campaign_id: identifier(input.campaignId),
					session_id: identifier(input.sessionId),
					source_id: identifier(input.sourceId),
					glossary: input.glossary,
					context: input.context,
				},
				key,
			),
		);
	}
	async transcription(input: CraigTranscriptionInput, key: string, signal: AbortSignal) {
		const payload = buildCraigTranscriptionRequest({
			...input,
			campaignId: identifier(input.campaignId),
			sessionId: identifier(input.sessionId),
			sourceId: identifier(input.sourceId),
		});
		return parseJob(
			await this.json(
				"/jobs",
				signal,
				payload,
				key,
			),
		);
	}
	async synthetic(key: string, signal: AbortSignal) {
		return parseJob(
			await this.json(
				"/jobs",
				signal,
				{
					kind: "synthetic.fixture",
					campaign_id: "synthetic-campaign",
					session_id: "synthetic-session",
					source_id: "synthetic-source",
					units: 3,
				},
				key,
			),
		);
	}
	async benchmarkResult(id: string, signal: AbortSignal) {
		return parseBenchmarkResult(
			await this.json(`/jobs/${identifier(id)}/result`, signal),
			id,
		);
	}
	async benchmarkAttemptResult(id: string, signal: AbortSignal) {
		return parseBenchmarkAttemptResult(
			await this.json(`/jobs/${identifier(id)}/result`, signal),
			id,
		);
	}
	async benchmarkEvidence(benchmarkId: string, signal: AbortSignal) {
		const id = benchmarkIdentifier(benchmarkId);
		return parseBenchmarkEvidenceSummary(
			await this.reviewJson(`/benchmarks/${id}`, signal),
			id,
		);
	}
	async benchmarkTranscript(
		benchmarkId: string,
		profileId: CraigTranscriptionInput["profileId"],
		signal: AbortSignal,
	) {
		const id = benchmarkIdentifier(benchmarkId);
		return parseBenchmarkTranscriptSnapshot(
			await this.reviewJson(
				`/benchmarks/${id}/profiles/${profileId}/snapshot`,
				signal,
			),
			id,
			profileId,
		);
	}
	async benchmarkArtifact(
		benchmarkId: string,
		profileId: CraigTranscriptionInput["profileId"],
		format: "json" | "txt" | "txt-plain" | "vtt" | "srt",
		signal: AbortSignal,
	) {
		const id = benchmarkIdentifier(benchmarkId);
		return this.raw(
			`/benchmarks/${id}/profiles/${profileId}/artifacts/${format}`,
			signal,
		);
	}
	async benchmarkEvidenceZip(benchmarkId: string, signal: AbortSignal) {
		const id = benchmarkIdentifier(benchmarkId);
		return this.raw(`/benchmarks/${id}/export.zip`, signal, "application/zip");
	}
	async benchmarkReference(benchmarkId: string, signal: AbortSignal) {
		if (!BENCHMARK_ID_PATTERN.test(benchmarkId))
			throw new BridgeError("invalid_response");
		return parseBenchmarkReferenceResponse(
			await this.benchmarkReferenceJson(
				`/benchmarks/${benchmarkId}/reference`,
				signal,
			),
		);
	}

	async benchmarkReferenceDraft(
		benchmarkId: string,
		profileId: CraigTranscriptionInput["profileId"],
		signal: AbortSignal,
	) {
		if (!BENCHMARK_ID_PATTERN.test(benchmarkId))
			throw new BridgeError("invalid_response");
		return parseBenchmarkReferenceDraft(
			await this.benchmarkReferenceJson(
				`/benchmarks/${benchmarkId}/profiles/${profileId}/reference-draft`,
				signal,
			),
		);
	}

	async saveBenchmarkReference(
		benchmarkId: string,
		input: BenchmarkReferenceSaveInput,
		signal: AbortSignal,
	) {
		if (!BENCHMARK_ID_PATTERN.test(benchmarkId))
			throw new BridgeError("invalid_response");
		const raw = record(
			await this.benchmarkReferenceJson(
				`/benchmarks/${benchmarkId}/references`,
				signal,
				serializeBenchmarkReferenceSave(input),
			),
		);
		if (raw.schema_version !== "tda_benchmark_reference_save_v1")
			throw new BridgeError("invalid_response");
		const reference = parseBenchmarkReference(raw.reference);
		const status = parseBenchmarkReferenceStatus(raw.status);
		const quality =
			raw.quality === null || raw.quality === undefined
				? null
				: parseBenchmarkQualitySummary(raw.quality);
		if (
			reference.benchmarkId !== benchmarkId ||
			status.benchmarkId !== benchmarkId ||
			(quality && quality.benchmarkId !== benchmarkId)
		)
			throw new BridgeError("invalid_response");
		return { reference, status, quality };
	}

	async benchmarkQuality(benchmarkId: string, signal: AbortSignal) {
		if (!BENCHMARK_ID_PATTERN.test(benchmarkId))
			throw new BridgeError("invalid_response");
		const value = parseBenchmarkQualitySummary(
			await this.benchmarkReferenceJson(
				`/benchmarks/${benchmarkId}/quality`,
				signal,
			),
		);
		if (value.benchmarkId !== benchmarkId)
			throw new BridgeError("invalid_response");
		return value;
	}

	async benchmarkQualityInspection(
		benchmarkId: string,
		profileId: CraigTranscriptionInput["profileId"],
		signal: AbortSignal,
	) {
		if (!BENCHMARK_ID_PATTERN.test(benchmarkId))
			throw new BridgeError("invalid_response");
		const value = parseBenchmarkQualityInspection(
			await this.benchmarkReferenceJson(
				`/benchmarks/${benchmarkId}/quality/${profileId}/inspection`,
				signal,
			),
		);
		if (value.benchmarkId !== benchmarkId || value.profileId !== profileId)
			throw new BridgeError("invalid_response");
		return value;
	}
	async result(id: string, signal: AbortSignal) {
		return parseResultSummary(
			await this.json(`/jobs/${identifier(id)}/result`, signal),
			id,
		);
	}

	async localSources(signal: AbortSignal) {
		return parseLocalSources(await this.json("/sources", signal));
	}

	async localRunCatalog(
		signal: AbortSignal,
		options: Readonly<{ cursor?: string; limit?: number }> = {},
	) {
		const params = new URLSearchParams();
		if (options.cursor !== undefined) params.set("cursor", options.cursor);
		if (options.limit !== undefined) params.set("limit", String(options.limit));
		const query = params.size ? `?${params.toString()}` : "";
		return parseLocalRunCatalogPage(await this.json(`/runs${query}`, signal));
	}

	async localRuns(sourceId: string, signal: AbortSignal) {
		return parseLocalRuns(
			await this.json(`/sources/${identifier(sourceId)}/runs`, signal),
		);
	}

	async deleteLocalRun(
		sourceId: string,
		runId: string,
		transcriptSha256: string,
		operationId: string,
		signal: AbortSignal,
	) {
		if (!/^[0-9a-f]{64}$/u.test(transcriptSha256))
			throw new BridgeError("invalid_response");
		if (!/^[0-9a-f-]{36}$/u.test(operationId))
			throw new BridgeError("invalid_response");
		const receipt = parseLocalRunDeleteReceipt(
			await this.json(
				`/sources/${identifier(sourceId)}/runs/${runIdentifier(runId)}/delete`,
				signal,
				{ transcript_sha256: transcriptSha256, operation_id: operationId },
			),
		);
		if (
			receipt.sourceId !== sourceId ||
			receipt.runId !== runId ||
			receipt.transcriptSha256 !== transcriptSha256
		)
			throw new BridgeError("invalid_response");
		return receipt;
	}

	async localReview(sourceId: string, runId: string, signal: AbortSignal) {
		return parseLocalReview(
			await this.reviewJson(
				`/sources/${identifier(sourceId)}/runs/${runIdentifier(runId)}/review`,
				signal,
			),
		);
	}

	async localReviewBase(sourceId: string, runId: string, signal: AbortSignal) {
		const review = parseLocalReview(
			await this.reviewJson(
				`/sources/${identifier(sourceId)}/runs/${runIdentifier(runId)}/review/base`,
				signal,
			),
			{ requireAbsoluteTimeline: true },
		);
		const timelineInvalid = review.segments.some(
			(segment) =>
				typeof segment.timelineStart !== "number" ||
				!Number.isFinite(segment.timelineStart) ||
				typeof segment.timelineEnd !== "number" ||
				!Number.isFinite(segment.timelineEnd) ||
				segment.timelineStart < 0 ||
				segment.timelineEnd < segment.timelineStart,
		);
		if (
			review.sourceId !== sourceId ||
			review.runId !== runId ||
			review.persistence !== "ephemeral_base" ||
			review.draftRevision !== null ||
			review.draftSha256 !== null ||
			timelineInvalid
		)
			throw new BridgeError("invalid_response");
		return review;
	}

	async repairPublicationTarget(sourceId: string, runId: string, signal: AbortSignal) {
        await this.json(`/sources/${identifier(sourceId)}/runs/${runIdentifier(runId)}/publication-target/repair`, signal, {});
        return this.localReview(sourceId, runId, signal);
    }

	async saveLocalReview(
		sourceId: string,
		runId: string,
		baseline: LocalReview,
		status: LocalReviewStatus,
		segments: readonly LocalReviewSegment[],
		signal: AbortSignal,
	) {
		if (baseline.snapshotContract !== "tda_local_review_cas_v1")
			throw new BridgeError("incompatible", "LOCAL_REVIEW_SNAPSHOT_CONTRACT_REQUIRED");
		if (baseline.sourceId !== sourceId || baseline.runId !== runId)
			throw new BridgeError("conflict", "LOCAL_REVIEW_DRAFT_CONFLICT");
		const expected = baseline.persistence === "ephemeral_base"
			? { persistence: "ephemeral_base", base_transcript_sha256: baseline.baseTranscriptSha256 }
			: { persistence: "persisted", draft_revision: baseline.draftRevision, draft_sha256: baseline.draftSha256 };
		return parseLocalReview(
			await this.reviewJson(
				`/sources/${identifier(sourceId)}/runs/${runIdentifier(runId)}/review`,
				signal,
				{
					snapshot_contract: baseline.snapshotContract,
					expected,
					status,
					segments: segments.map((segment) => ({
						track_number: segment.trackNumber,
						segment_id: segment.segmentId,
						start: segment.start,
						end: segment.end,
						text: segment.text,
						speaker: segment.speaker,
						reviewed: segment.reviewed,
					})),
				},
			),
		);
	}
}
