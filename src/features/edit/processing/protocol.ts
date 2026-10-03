import { supportsQwenAlignmentRuntime } from "./compatibility";
import { PROCESSING_TIMING_VERSION, parseEngineMetrics, type EngineProcessingMetrics } from "./engine-metrics";
import { isReviewStringV1 } from "../../transcript-review/text-contract";
import { parseTrustedAbsoluteTime, type TrustedAbsoluteTime } from "../../transcript-review/time-contract";

export const LOCAL_API = "http://127.0.0.1:8765/api/v1";
export type Lifecycle = "preparing" | "ready" | "paused";
export type TranscriptionProfileId =
	| "whisper-turbo"
	| "whisper-detailed"
	| "qwen-fast"
	| "qwen-quality";
export type Health = {
	api_version: "1";
	service_version: string;
	lifecycle: Lifecycle;
};
export type TranscriptionProfileState = {
	id: TranscriptionProfileId;
	engine: "whisper" | "qwen3";
	ready: boolean;
	preparationRequired: boolean;
	reason: string | null;
	benchmarkReady?: boolean;
	benchmarkPreparationRequired?: boolean;
	benchmarkReason?: string | null;
	model?: string | null;
	modelRevision?: string | null;
	runtimeVersion?: string | null;
	runtimeWorkerSha256?: string | null;
	computeType?: string | null;
	gpuModel?: string | null;
	gpuComputeCapability?: string | null;
};
export type Capabilities = {
	capabilities: string[];
	sync: boolean;
	device: { id: string; label: string };
	transcription: {
		profiles: TranscriptionProfileId[];
		catalog: TranscriptionProfileState[];
	};
};
export type QwenRuntimeMaintenanceStatus = {
	schema: "tda_qwen_runtime_maintenance_v1";
	state: "idle" | "running" | "completed" | "failed";
	active: boolean;
	operationId: string | null;
	mode: "check" | "update" | null;
	stage: string;
	title: string;
	detail: string;
	sequence: number;
	installedStatus: string;
	installedVersion: string | null;
	minimumVersion: string;
	stableStatus: "unknown" | "compatible" | "below_minimum" | "unavailable";
	stableVersion: string | null;
	stableTag: string | null;
	stableSize: number | null;
	stablePartCount: number | null;
	updateAvailable: boolean | null;
	canUpdate: boolean;
	errorCode: string | null;
};

export type PreparationStatus = {
	schema: "tda_profile_preparation_v1";
	state: "idle" | "running" | "completed" | "failed" | "interrupted";
	active: boolean;
	operationId: string | null;
	sourceId: string | null;
	profileId: TranscriptionProfileId | null;
	engine: "whisper" | "qwen3" | null;
	purpose: "transcription" | "benchmark";
	stage: string;
	title: string;
	detail: string;
	sequence: number;
	elapsedSeconds: number;
	errorCode: string | null;
};
export type CraigSource = {
	schemaVersion: "tda_craig_ingest_v1";
	sourceId: string;
	sourceSha256: string;
	recordingId?: string | null;
	sizeBytes: number;
	trackCount: number;
	audioWorkSeconds: number | null;
	sessionDurationSeconds: number | null;
	minimumTrackDurationSeconds: number | null;
	reused: boolean;
};
export type SessionTimestampConfidence =
	| "trusted_absolute"
	| "ambiguous"
	| "opaque"
	| "missing";
export type SessionTimelineMode = "unresolved" | "automatic" | "manual";
export type SessionOverlapResolution =
	| "prefer_earlier_until"
	| "prefer_later_from";
export type SessionPartRelation =
	| "first"
	| "unknown"
	| "contiguous"
	| "gap"
	| "overlap"
	| "order_conflict";
export type SessionWorkspacePart = {
	partId: string;
	sourceId: string;
	ordinal: number;
	selectedRunId: string | null;
	sourceState: "ready" | "invalid";
	timelineMode: SessionTimelineMode;
	sessionOffsetSeconds: number | null;
	trimStartSeconds: number;
	trimEndSeconds: number | null;
	gapConfirmed: boolean;
	overlapResolution: SessionOverlapResolution | null;
	overlapBoundarySeconds: number | null;
	sourceStartTime: string | null;
	sourceStartConfidence: SessionTimestampConfidence;
	sourceStartUtc: string | null;
	sourceDurationSeconds: number | null;
	effectiveStartSeconds: number | null;
	effectiveEndSeconds: number | null;
	relationToPrevious: SessionPartRelation;
	relationSeconds: number | null;
	overlapResolutionValid: boolean;
	createdAt: string;
	updatedAt: string;
};
export type SessionWorkspaceTimeline = {
	policyVersion: "tda_session_timeline_v1";
	segmentBoundaryPolicy: "segment_start_owner_v1";
	fingerprintSha256: string;
	state:
		| "ready"
		| "needs_timing"
		| "gap_unconfirmed"
		| "overlap_unresolved"
		| "order_conflict"
		| "source_invalid";
	allSourcesTrusted: boolean;
	automaticOrderAvailable: boolean;
	gapCount: number;
	overlapCount: number;
	orderConflictCount: number;
	unresolvedOverlapCount: number;
	unconfirmedGapCount: number;
};
export type SessionWorkspace = {
	schemaVersion: "tda_session_workspace_v1";
	campaignId: string;
	sessionId: string;
	revision: number;
	orderingMode: "attachment" | "automatic" | "manual";
	createdAt: string;
	updatedAt: string;
	parts: SessionWorkspacePart[];
	timeline: SessionWorkspaceTimeline;
};
export type SessionTranscriptionIntentState = {
	schemaVersion: "tda_session_transcription_intent_v1";
	campaignId: string;
	sessionId: string;
	requestId: string;
	profileId: TranscriptionProfileId;
	context: string;
	glossary: string;
	contextSha256: string;
	glossarySha256: string;
	createdAt: string;
	updatedAt: string;
};
export type SessionParticipantObservation = {
	observationId: string;
	partId: string;
	sourceId: string;
	partOrdinal: number;
	trackNumber: number;
	rawSpeaker: string;
	username: string | null;
	discriminator: string | null;
	discordId: string | null;
};
export type SessionParticipantResolution =
	| "manual"
	| "discord_id"
	| "local_observation";
export type SessionParticipant = {
	participantId: string;
	resolution: SessionParticipantResolution;
	profileId: null;
	displaySpeaker: string;
	observationIds: string[];
};
export type SessionParticipantConflict = {
	code: string;
	severity: "info" | "warning" | "error";
	requiresResolution: boolean;
	observationIds: string[];
	discordId: string | null;
	labelKey: string | null;
	trackNumber: number | null;
	sourceId: string | null;
};
export type SessionParticipantAssignment = {
	observationId: string;
	participantId: string;
};
export type SessionParticipantMapping = {
	schemaVersion: "tda_session_participant_mapping_v1";
	policy: "strong_discord_or_manual_v1";
	campaignId: string;
	sessionId: string;
	workspaceRevision: number;
	mappingSha256: string;
	approvalBlocked: boolean;
	observations: SessionParticipantObservation[];
	participants: SessionParticipant[];
	conflicts: SessionParticipantConflict[];
	manualAssignments: SessionParticipantAssignment[];
};
export type CraigBenchmarkInput = {
	campaignId: string;
	sessionId: string;
	sourceId: string;
	glossary: string;
	context: string;
};

export type CraigTranscriptionInput = {
	campaignId: string;
	sessionId: string;
	sourceId: string;
	profileId: TranscriptionProfileId;
	glossary: string;
	context: string;
};
export type JobStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "interrupted";
export type JobContext = {
	campaignId: string;
	sessionId: string;
	sourceId: string;
	profileId?: TranscriptionProfileId;
	audioWorkSeconds?: number | null;
	trackDurationsSeconds?: readonly number[];
	sampleIdentitySha256?: string | null;
	sampleSeconds?: number | null;
	profiles?: readonly TranscriptionProfileId[];
	prepared?: boolean;
};
export type ExecutionDevice = Readonly<{ kind: "cpu" | "cuda"; logicalIndex: number | null; physicalUuid: string | null; pciBusId: string | null }>;
export type JobTrackTiming = {
	track: number;
	totalTracks: number | null;
	speaker: string | null;
	startedAt: string;
	finishedAt: string | null;
	processingSeconds: number | null;
};
export type JobTiming = {
	schemaVersion: "tda_job_timing_v1";
	attemptStartedAt: string | null;
	attemptFinishedAt: string | null;
	attemptElapsedSeconds: number | null;
	stageStartedAt: string | null;
	stageElapsedSeconds: number | null;
	tracks: readonly JobTrackTiming[];
};
export type LocalJob = {
	timing: JobTiming;
	executionDevice?: ExecutionDevice | null;
	id: string;
	kind: string;
	status: JobStatus;
	stage: string;
	progress: null | { completed: number; total: number; unit: string };
	error: null | { code: string; recoverable: boolean };
	result_available: boolean;
	updated_at: string;
	attempt: number;
	context: JobContext | null;
};
export type JobListScope = "all" | "active" | "history";
export type JobListCounts = Readonly<Record<JobStatus, number>>;
export type JobListPage = {
	scope: JobListScope;
	jobs: readonly LocalJob[];
	hasMore: boolean;
	nextCursor: string | null;
	totalMatching: number;
	counts: JobListCounts;
};
export type JobEventLevel = "info" | "warning" | "error";
export type JobEventValue = string | number | boolean | null;
export type JobEvent = {
	seq: number;
	attempt: number | null;
	code: string;
	at: string;
	level: JobEventLevel;
	data: Readonly<Record<string, JobEventValue>>;
};
export type JobEventPage = {
	events: readonly JobEvent[];
	hasMore: boolean;
	nextAfterSeq: number | null;
	nextBeforeSeq: number | null;
};
export type JobActivityMetric =
	| "qwen_windows_completed"
	| "whisper_segments_completed"
	| "model_downloaded_bytes";
export type JobActivityItem = {
	track: number | null;
	metric: JobActivityMetric;
	value: number;
	updatedAt: string;
};
export type JobActivity = {
	schemaVersion: "tda_job_activity_v1";
	attempt: number;
	metrics: readonly JobActivityItem[];
};
export type SystemGpu = {
	uuid?: string | null;
	pciBusId?: string | null;
	index: number;
	name: string;
	utilizationPercent: number | null;
	memoryUsedBytes: number | null;
	memoryTotalBytes: number | null;
};
export type SystemSnapshot = {
	sampledAt: string;
	host: { os: string; cpu: string | null };
	cpu: { utilizationPercent: number | null };
	memory: {
		usedBytes: number | null;
		totalBytes: number | null;
		percent: number | null;
	};
	gpus: readonly SystemGpu[];
};
export type BenchmarkProfileResult = {
	profileId: TranscriptionProfileId;
	engine: "whisper" | "qwen3";
	model: string;
	modelRevision: string | null;
	device: string;
	computeType: string | null;
	alignment: string;
	sampleSeconds: number;
	audioWorkSeconds: number;
	sessionDurationSeconds: number;
	processingTimingVersion: typeof PROCESSING_TIMING_VERSION;
	processingSeconds: number;
	rtf: number | null;
	wordCount: number;
	segmentCount: number;
	trackCount: number;
	warningCount: number;
	executionLineage: LocalExecutionLineage | null;
	transcriptSha256: string | null;
	transcriptSizeBytes: number | null;
	artifactAvailable: boolean;
};

export type BenchmarkResult = {
	schemaVersion: "tda_processing_benchmark_v1";
	jobId: string;
	sourceId: string;
	campaignId: string;
	sessionId: string;
	sampleIdentitySha256: string;
	sampleSeconds: number;
	executionMode: "prepared_artifacts_fresh_worker_per_profile_v1";
	trackCount: number;
	audioWorkSeconds: number;
	prepared: boolean;
	benchmarkId: string | null;
	bundleManifestSha256: string | null;
	bundleSizeBytes: number | null;
	profiles: readonly BenchmarkProfileResult[];
};

export type ResultSummary = {
	jobId: string;
	campaignId: string;
	sessionId: string;
	sourceId: string;
	publicationId: string;
	profileId?: TranscriptionProfileId;
	transcriptSha256?: string;
	runId?: string;
};
export type LocalSourceSummary = {
	sourceId: string;
	sourceSha256: string;
	recordingId: string | null;
	trackCount: number;
};
export type LocalPublicationTarget = {
	campaignSlug: string;
	sourceSessionId: string;
	jobId: string;
	attempt: number;
};
export type LocalRunDeleteReceipt = {
	schemaVersion: "tda_local_run_delete_receipt_v1";
	sourceId: string;
	runId: string;
	transcriptSha256: string;
	deleted: true;
	reviewDeleted: boolean;
	cloudChanged: false;
	deletedAt: string;
};
export type LocalExecutionLineage = {
	schemaVersion: "tda_execution_lineage_v1";
	companionVersion: string | null;
	runtimeArtifact?: Readonly<{ runtimeId: string; version: string; workerSha256: string; archiveSha256: string | null }> | null;
	executionDevice?: ExecutionDevice | null;
	runtimeFamily: string | null;
	runtimeVersion: string | null;
	device: string | null;
	computeType: string | null;
	gpu: {
		vendor: string | null;
		index: number | null;
		model: string | null;
		vramTotalBytes: number | null;
		computeCapability: string | null;
		driverVersion: string | null;
	} | null;
};
export type LocalReviewStatus = "draft" | "reviewed" | "approved_local";

export type LocalRunReviewSummary = {
	status: LocalReviewStatus | "unknown";
	draftRevision: number | null;
	reviewPercent: number | null;
	updatedAt: string | null;
};

export type LocalRunCatalogPage = {
	runs: readonly LocalRunSummary[];
	hasMore: boolean;
	nextCursor: string | null;
};
export type LocalRunSummary = {
	runId: string;
	sourceId: string;
	profileId: string;
	engine: string | null;
	model: string | null;
	modelRevision: string | null;
	device: string | null;
	computeType: string | null;
	alignment: string | null;
	executionLineage: LocalExecutionLineage | null;
	language: string | null;
	completedAt: string | null;
	transcriptSha256: string;
	transcriptSizeBytes: number;
	stats: {
		audioWorkSeconds: number | null;
		processingSeconds: number | null;
		processingMetrics?: EngineProcessingMetrics | null;
		sessionDurationSeconds: number | null;
		durationSemantics?: "session_extent_v1";
		rtf: number | null;
		wordCount: number | null;
		segmentCount: number | null;
		trackCount: number | null;
		turnCount: number | null;
		deduplicatedSegmentCount: number | null;
		warningCount: number | null;
	};
	publicationTarget: LocalPublicationTarget | null;
	publicationTargetState?: "valid" | "invalid" | "unbound";
	review: LocalRunReviewSummary | null;
};
export type LocalReviewSegment = {
	trackNumber: number;
	segmentId: string;
	start: number;
	end: number;
	/** Absolute session timeline coordinate when supplied by the Agent. */
	timelineStart?: number;
	/** Absolute session timeline coordinate when supplied by the Agent. */
	timelineEnd?: number;
	/** Trusted source wall-clock projection; never inferred from browser timezone. */
	absoluteTime?: TrustedAbsoluteTime | null;
	text: string;
	speaker: string;
	reviewed: boolean;
};
export type LocalReview = {
	sourceId: string;
	runId: string;
	baseTranscriptSha256: string;
	draftRevision: number | null;
	draftSha256: string | null;
	persistence?: "persisted" | "ephemeral_base";
	snapshotContract?: "tda_local_review_cas_v1";
	status: LocalReviewStatus;
	approvalCurrent: boolean;
	approvedAt: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	lineage: {
		profileId: string;
		engine: string | null;
		model: string | null;
		modelRevision: string | null;
		device: string | null;
		computeType: string | null;
		alignment: string | null;
		executionLineage: LocalExecutionLineage | null;
		completedAt: string | null;
	};
	stats: {
		audioWorkSeconds: number | null;
		processingSeconds: number | null;
		processingMetrics?: EngineProcessingMetrics | null;
		sessionDurationSeconds: number | null;
		durationSemantics?: "session_extent_v1";
		rtf: number | null;
		wordCount: number | null;
		segmentCount: number | null;
		trackCount: number | null;
	};
	warnings: readonly string[];
	warningSummary?: {
		totalCount: number;
		displayedCount: number;
		truncated: boolean;
	};
	publicationTarget: LocalPublicationTarget | null;
	publicationTargetState?: "valid" | "invalid" | "unbound";
	review: {
		reviewedSegments: number;
		totalSegments: number;
		reviewPercent: number;
		editedSegments: number;
		wordCount: number;
		warningCount: number;
	};
	segments: readonly LocalReviewSegment[];
	sync: { status: "not_configured" };
};
export type BridgeErrorCode =
	| "unreachable"
	| "unauthorized"
	| "forbidden"
	| "api_incompatible"
	| "version_incompatible"
	| "session_incompatible"
	| "incompatible"
	| "invalid_response"
	| "payload_too_large"
	| "timeout"
	| "conflict"
	| "service_error";
export type BridgeErrorDetails = Readonly<{
	detectedServiceVersion?: string;
	minimumServiceVersion?: string;
	detectedApiVersion?: string;
	requiredApiVersion?: string;
}>;
export class BridgeError extends Error {
	constructor(
		public readonly code: BridgeErrorCode,
		public readonly serverCode: string | null = null,
		public readonly details: BridgeErrorDetails = {},
	) {
		super(serverCode ?? code);
	}
}
function invalid(): never {
	throw new BridgeError("invalid_response");
}
export function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return invalid();
	return value as Record<string, unknown>;
}
export function text(value: unknown, max = 128): string {
	if (
		typeof value !== "string" ||
		!value.length ||
		value.length > max ||
		Array.from(value).some(
			(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
		)
	)
		return invalid();
	return value;
}
function nullableText(value: unknown, max = 160): string | null {
	if (value === null || value === undefined) return null;
	return text(value, max);
}
export function identifier(value: unknown): string {
	const id = text(value);
	if (!/^[A-Za-z0-9_-]+$/u.test(id)) return invalid();
	return id;
}
function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") return invalid();
	return value;
}
function nonNegativeInteger(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		return invalid();
	return value;
}
function nullableNonNegativeNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		return invalid();
	return value;
}
function nullablePercent(value: unknown): number | null {
	const parsed = nullableNonNegativeNumber(value);
	if (parsed !== null && parsed > 100) return invalid();
	return parsed;
}
function isoDate(value: unknown): string {
	const parsed = text(value, 64);
	if (!Number.isFinite(Date.parse(parsed))) return invalid();
	return parsed;
}
function sha256(value: unknown): string {
	const parsed = text(value, 64);
	if (!/^[a-f0-9]{64}$/u.test(parsed)) return invalid();
	return parsed;
}
export function runIdentifier(value: unknown): string {
	const id = text(value, 196);
	if (!/^[A-Za-z0-9_-]{1,196}$/u.test(id)) return invalid();
	return id;
}
function contentText(value: unknown, max: number): string {
	if (typeof value !== "string" || !value.trim() || value.length > max)
		return invalid();
	if (value.includes("\0")) return invalid();
	return value;
}
function nonNegativeNumber(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		return invalid();
	return value;
}
function nullableIsoDate(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	return isoDate(value);
}
export function transcriptionProfile(value: unknown): TranscriptionProfileId {
	const parsed = text(value, 32);
	if (
		!["whisper-turbo", "whisper-detailed", "qwen-fast", "qwen-quality"].includes(
			parsed,
		)
	)
		return invalid();
	return parsed as TranscriptionProfileId;
}
export function parseHealth(value: unknown): Health {
	const row = record(value);
	const apiVersion = text(row.api_version, 16);
	if (apiVersion !== "1") {
		throw new BridgeError("api_incompatible", null, {
			detectedApiVersion: apiVersion,
			requiredApiVersion: "1",
		});
	}
	if (!["preparing", "ready", "paused"].includes(String(row.lifecycle)))
		return invalid();
	return {
		api_version: "1",
		service_version: text(row.service_version),
		lifecycle: row.lifecycle as Lifecycle,
	};
}
export function parseCapabilities(value: unknown): Capabilities {
	const row = record(value);
	const device = record(row.device);
	if (!Array.isArray(row.capabilities) || row.capabilities.length > 100)
		return invalid();
	let profiles: TranscriptionProfileId[] = [];
	let catalog: TranscriptionProfileState[] = [];
	if (row.transcription !== undefined && row.transcription !== null) {
		const transcription = record(row.transcription);
		const qwenGateState = new Map<
			TranscriptionProfileId,
			{ ready: boolean; runtimeVersion: string | null; reason: string | null }
		>();
		if (transcription.qwen_physical_gate !== undefined) {
			const gates = record(transcription.qwen_physical_gate);
			for (const profileId of ["qwen-fast", "qwen-quality"] as const) {
				if (gates[profileId] === undefined) continue;
				const gate = record(gates[profileId]);
				if (transcriptionProfile(gate.profile_id) !== profileId) return invalid();
				const ready = boolean(gate.ready);
				const runtimeVersion =
					gate.runtime_version === null || gate.runtime_version === undefined
						? null
						: text(gate.runtime_version, 32);
				if (ready && runtimeVersion === null) return invalid();
				qwenGateState.set(profileId, {
					ready,
					runtimeVersion,
					reason:
						gate.reason === null || gate.reason === undefined
							? null
							: text(gate.reason, 96),
				});
			}
		}
		if (!Array.isArray(transcription.profiles) || transcription.profiles.length > 8)
			return invalid();
		profiles = transcription.profiles.map(transcriptionProfile);
		if (new Set(profiles).size !== profiles.length) return invalid();

		if (transcription.catalog !== undefined) {
			if (!Array.isArray(transcription.catalog) || transcription.catalog.length > 8)
				return invalid();
			catalog = transcription.catalog.map((raw) => {
				const item = record(raw);
				const engine = text(item.engine, 16);
				if (engine !== "whisper" && engine !== "qwen3") return invalid();
				const reason =
					item.reason === null || item.reason === undefined
						? null
						: text(item.reason, 96);
				const benchmarkReason =
					item.benchmark_reason === null || item.benchmark_reason === undefined
						? null
						: text(item.benchmark_reason, 96);
				return {
					id: transcriptionProfile(item.id),
					engine,
					ready: boolean(item.ready),
					preparationRequired: boolean(item.preparation_required),
					reason,
					benchmarkReady:
						item.benchmark_ready === undefined ? false : boolean(item.benchmark_ready),
					benchmarkPreparationRequired:
						item.benchmark_preparation_required === undefined
							? false
							: boolean(item.benchmark_preparation_required),
					benchmarkReason,
					model: nullableText(item.model, 256),
					modelRevision: nullableText(item.model_revision, 128),
					runtimeVersion: nullableText(item.runtime_version, 64),
					runtimeWorkerSha256:
						item.runtime_worker_sha256 === null || item.runtime_worker_sha256 === undefined
							? null
							: sha256(item.runtime_worker_sha256),
					computeType: nullableText(item.compute_type, 64),
					gpuModel: nullableText(item.gpu_model, 160),
					gpuComputeCapability: nullableText(item.gpu_compute_capability, 32),
				};
			});
			if (new Set(catalog.map((item) => item.id)).size !== catalog.length)
				return invalid();
		} else {
			catalog = profiles.map((id) => ({
				id,
				engine: id.startsWith("qwen-") ? "qwen3" : "whisper",
				ready: true,
				preparationRequired: false,
				reason: null,
				benchmarkReady: false,
				benchmarkPreparationRequired: false,
				benchmarkReason: "BENCHMARK_RUNTIME_CONTRACT_REQUIRED",
			}));
		}

		const qwenBlocked = new Set<TranscriptionProfileId>();
		catalog = catalog.map((item) => {
			if (item.engine !== "qwen3") return item;
			const gate = qwenGateState.get(item.id);

			// A stale runtime can make the physical gate fail before it is able to
			// expose its own runtime identity. In that state the catalog still
			// carries the installed runtime version, so fence it before interpreting
			// the gate failure as ordinary first-use preparation. The catalog also
			// remains authoritative enough to fail closed when an older Companion
			// omits the optional gate snapshot entirely.
			const runtimeVersion = gate?.runtimeVersion ?? item.runtimeVersion ?? null;
			if (
				runtimeVersion !== null &&
				!supportsQwenAlignmentRuntime(runtimeVersion)
			) {
				qwenBlocked.add(item.id);
				return {
					...item,
					ready: false,
					preparationRequired: false,
					reason: "QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED",
					benchmarkReady: false,
					benchmarkPreparationRequired: false,
					benchmarkReason: "QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED",
				};
			}
			if (!gate) return item;
			if (!gate.ready) {
				qwenBlocked.add(item.id);
				return {
					...item,
					ready: false,
					preparationRequired: true,
					reason: gate.reason ?? "QWEN_PHYSICAL_ACCEPTANCE_REQUIRED",
				};
			}
			return item;
		});
		profiles = profiles.filter((profileId) => !qwenBlocked.has(profileId));
	}
	return {
		capabilities: row.capabilities.map((value) => text(value)),
		sync: boolean(row.sync),
		device: { id: identifier(device.id), label: text(device.label) },
		transcription: { profiles, catalog },
	};
}

export function parseQwenRuntimeMaintenanceStatus(
	value: unknown,
): QwenRuntimeMaintenanceStatus {
	const row = record(value);
	if (row.schema !== "tda_qwen_runtime_maintenance_v1") return invalid();
	if (!["idle", "running", "completed", "failed"].includes(String(row.state)))
		return invalid();
	const mode =
		row.mode === null || row.mode === undefined ? null : text(row.mode, 16);
	if (mode !== null && mode !== "check" && mode !== "update") return invalid();
	const stableStatus = text(row.stable_status, 32);
	if (!["unknown", "compatible", "below_minimum", "unavailable"].includes(stableStatus))
		return invalid();
	const nullableBoolean = (raw: unknown): boolean | null =>
		raw === null || raw === undefined ? null : boolean(raw);
	const stablePartCount =
		row.stable_part_count === null || row.stable_part_count === undefined
			? null
			: nonNegativeInteger(row.stable_part_count);
	return {
		schema: "tda_qwen_runtime_maintenance_v1",
		state: row.state as QwenRuntimeMaintenanceStatus["state"],
		active: boolean(row.active),
		operationId: nullableText(row.operation_id, 64),
		mode,
		stage: text(row.stage, 64),
		title: text(row.title, 240),
		detail: row.detail === "" ? "" : text(row.detail, 500),
		sequence: nonNegativeInteger(row.sequence),
		installedStatus: text(row.installed_status, 64),
		installedVersion: nullableText(row.installed_version, 64),
		minimumVersion: text(row.minimum_version, 64),
		stableStatus: stableStatus as QwenRuntimeMaintenanceStatus["stableStatus"],
		stableVersion: nullableText(row.stable_version, 64),
		stableTag: nullableText(row.stable_tag, 128),
		stableSize: nullableNonNegativeNumber(row.stable_size),
		stablePartCount,
		updateAvailable: nullableBoolean(row.update_available),
		canUpdate: boolean(row.can_update),
		errorCode: nullableText(row.error_code, 96),
	};
}

export function parsePreparationStatus(value: unknown): PreparationStatus {
	const row = record(value);
	if (row.schema !== "tda_profile_preparation_v1") return invalid();
	if (!["idle", "running", "completed", "failed", "interrupted"].includes(String(row.state)))
		return invalid();
	const nullableText = (raw: unknown, limit = 128) =>
		raw === null || raw === undefined ? null : text(raw, limit);
	const profile =
		row.profile_id === null || row.profile_id === undefined
			? null
			: transcriptionProfile(row.profile_id);
	const engine =
		row.engine === null || row.engine === undefined ? null : text(row.engine, 16);
	if (engine !== null && engine !== "whisper" && engine !== "qwen3")
		return invalid();
	const purpose =
		row.purpose === null || row.purpose === undefined
			? "transcription"
			: text(row.purpose, 16);
	if (purpose !== "transcription" && purpose !== "benchmark") return invalid();
	const elapsed =
		typeof row.elapsed_seconds === "number" &&
		Number.isFinite(row.elapsed_seconds) &&
		row.elapsed_seconds >= 0
			? row.elapsed_seconds
			: invalid();
	return {
		schema: "tda_profile_preparation_v1",
		state: row.state as PreparationStatus["state"],
		active: boolean(row.active),
		operationId: nullableText(row.operation_id, 64),
		sourceId: nullableText(row.source_id, 80),
		profileId: profile,
		engine,
		purpose,
		stage: text(row.stage, 64),
		title: text(row.title, 240),
		detail: row.detail === "" ? "" : text(row.detail, 500),
		sequence: nonNegativeInteger(row.sequence),
		elapsedSeconds: elapsed,
		errorCode: nullableText(row.error_code, 96),
	};
}
export function parseCraigSource(value: unknown): CraigSource {
	const row = record(value);
	if (row.schema_version !== "tda_craig_ingest_v1")
		throw new BridgeError("incompatible");
	const sourceId = identifier(row.source_id);
	const sourceSha256 = sha256(row.source_sha256);
	if (sourceId !== `craig-${sourceSha256}`) return invalid();
	const sizeBytes = nonNegativeInteger(row.size_bytes);
	const trackCount = nonNegativeInteger(row.track_count);
	if (sizeBytes <= 0 || trackCount <= 0 || trackCount > 256) return invalid();
	return {
		schemaVersion: "tda_craig_ingest_v1",
		sourceId,
		sourceSha256,
		recordingId: nullableText(row.recording_id, 256),
		sizeBytes,
		trackCount,
		audioWorkSeconds: nullableNonNegativeNumber(row.audio_work_seconds),
		sessionDurationSeconds: nullableNonNegativeNumber(row.session_duration_seconds),
		minimumTrackDurationSeconds: nullableNonNegativeNumber(
			row.minimum_track_duration_seconds,
		),
		reused: boolean(row.reused),
	};
}
export function parseSessionWorkspace(value: unknown): SessionWorkspace {
	const row = record(value);
	if (row.schema_version !== "tda_session_workspace_v1") return invalid();
	if (!Array.isArray(row.parts) || row.parts.length > 64) return invalid();
	const orderingMode = text(row.ordering_mode, 16);
	if (!["attachment", "automatic", "manual"].includes(orderingMode))
		return invalid();
	const parts = row.parts.map((raw, index) => {
		const part = record(raw);
		const partId = text(part.part_id, 32);
		const sourceId = identifier(part.source_id);
		const ordinal = nonNegativeInteger(part.ordinal);
		const sourceState = text(part.source_state, 16);
		const timelineMode = text(part.timeline_mode, 16);
		const startConfidence = text(part.source_start_confidence, 32);
		const relation = text(part.relation_to_previous, 24);
		const overlapResolution =
			part.overlap_resolution === null || part.overlap_resolution === undefined
				? null
				: text(part.overlap_resolution, 32);
		if (!/^[0-9a-f]{32}$/u.test(partId)) return invalid();
		if (!/^craig-[0-9a-f]{64}$/u.test(sourceId)) return invalid();
		if (ordinal !== index) return invalid();
		if (sourceState !== "ready" && sourceState !== "invalid") return invalid();
		if (!["unresolved", "automatic", "manual"].includes(timelineMode))
			return invalid();
		if (
			!["trusted_absolute", "ambiguous", "opaque", "missing"].includes(
				startConfidence,
			)
		)
			return invalid();
		if (
			!["first", "unknown", "contiguous", "gap", "overlap", "order_conflict"].includes(
				relation,
			)
		)
			return invalid();
		if (
			overlapResolution !== null &&
			!["prefer_earlier_until", "prefer_later_from"].includes(overlapResolution)
		)
			return invalid();
		return {
			partId,
			sourceId,
			ordinal,
			selectedRunId:
				part.selected_run_id === null || part.selected_run_id === undefined
					? null
					: runIdentifier(part.selected_run_id),
			sourceState,
			timelineMode: timelineMode as SessionTimelineMode,
			sessionOffsetSeconds: nullableNonNegativeNumber(
				part.session_offset_seconds,
			),
			trimStartSeconds: nonNegativeNumber(part.trim_start_seconds),
			trimEndSeconds: nullableNonNegativeNumber(part.trim_end_seconds),
			gapConfirmed:
				part.gap_confirmed === undefined ? false : boolean(part.gap_confirmed),
			overlapResolution: overlapResolution as SessionOverlapResolution | null,
			overlapBoundarySeconds: nullableNonNegativeNumber(
				part.overlap_boundary_seconds,
			),
			sourceStartTime: nullableText(part.source_start_time, 128),
			sourceStartConfidence:
				startConfidence as SessionTimestampConfidence,
			sourceStartUtc: nullableIsoDate(part.source_start_utc),
			sourceDurationSeconds: nullableNonNegativeNumber(
				part.source_duration_seconds,
			),
			effectiveStartSeconds: nullableNonNegativeNumber(
				part.effective_start_seconds,
			),
			effectiveEndSeconds: nullableNonNegativeNumber(
				part.effective_end_seconds,
			),
			relationToPrevious: relation as SessionPartRelation,
			relationSeconds: nullableNonNegativeNumber(part.relation_seconds),
			overlapResolutionValid: boolean(part.overlap_resolution_valid),
			createdAt: isoDate(part.created_at),
			updatedAt: isoDate(part.updated_at),
		} satisfies SessionWorkspacePart;
	});
	if (new Set(parts.map((part) => part.partId)).size !== parts.length)
		return invalid();
	if (new Set(parts.map((part) => part.sourceId)).size !== parts.length)
		return invalid();

	const timeline = record(row.timeline);
	const policyVersion = text(timeline.policy_version, 40);
	const segmentBoundaryPolicy = text(timeline.segment_boundary_policy, 40);
	const state = text(timeline.state, 32);
	if (policyVersion !== "tda_session_timeline_v1") return invalid();
	if (segmentBoundaryPolicy !== "segment_start_owner_v1") return invalid();
	if (
		![
			"ready",
			"needs_timing",
			"gap_unconfirmed",
			"overlap_unresolved",
			"order_conflict",
			"source_invalid",
		].includes(state)
	)
		return invalid();

	if (parts.length > 0 && parts[0].relationToPrevious !== "first") return invalid();
	if (parts.slice(1).some((part) => part.relationToPrevious === "first"))
		return invalid();

	const gapCount = nonNegativeInteger(timeline.gap_count);
	const overlapCount = nonNegativeInteger(timeline.overlap_count);
	const orderConflictCount =
		timeline.order_conflict_count === undefined
			? 0
			: nonNegativeInteger(timeline.order_conflict_count);
	const unresolvedOverlapCount = nonNegativeInteger(
		timeline.unresolved_overlap_count,
	);
	const unconfirmedGapCount = nonNegativeInteger(timeline.unconfirmed_gap_count);
	const observedGapCount = parts.filter(
		(part) => part.relationToPrevious === "gap",
	).length;
	const observedOverlapCount = parts.filter(
		(part) => part.relationToPrevious === "overlap",
	).length;
	const observedOrderConflictCount = parts.filter(
		(part) => part.relationToPrevious === "order_conflict",
	).length;
	const observedUnresolvedOverlapCount = parts.filter(
		(part) =>
			part.relationToPrevious === "overlap" && !part.overlapResolutionValid,
	).length;
	const observedUnconfirmedGapCount = parts.filter(
		(part) => part.relationToPrevious === "gap" && !part.gapConfirmed,
	).length;
	if (
		gapCount !== observedGapCount ||
		overlapCount !== observedOverlapCount ||
		orderConflictCount !== observedOrderConflictCount ||
		unresolvedOverlapCount !== observedUnresolvedOverlapCount ||
		unconfirmedGapCount !== observedUnconfirmedGapCount
	)
		return invalid();

	return {
		schemaVersion: "tda_session_workspace_v1",
		campaignId: identifier(row.campaign_id),
		sessionId: identifier(row.session_id),
		revision: nonNegativeInteger(row.revision),
		orderingMode: orderingMode as SessionWorkspace["orderingMode"],
		createdAt: isoDate(row.created_at),
		updatedAt: isoDate(row.updated_at),
		parts,
		timeline: {
			policyVersion: "tda_session_timeline_v1",
			segmentBoundaryPolicy: "segment_start_owner_v1",
			fingerprintSha256: sha256(timeline.fingerprint_sha256),
			state: state as SessionWorkspaceTimeline["state"],
			allSourcesTrusted: boolean(timeline.all_sources_trusted),
			automaticOrderAvailable: boolean(timeline.automatic_order_available),
			gapCount,
			overlapCount,
			orderConflictCount,
			unresolvedOverlapCount,
			unconfirmedGapCount,
		},
	};
}

export function parseSessionTranscriptionIntent(
	value: unknown,
): SessionTranscriptionIntentState {
	const row = record(value);
	if (row.schema_version !== "tda_session_transcription_intent_v1")
		return invalid();
	const localText = (input: unknown): string => {
		if (
			typeof input !== "string" ||
			Array.from(input).length > 1200 ||
			input.includes("\0")
		)
			return invalid();
		return input;
	};
	return {
		schemaVersion: "tda_session_transcription_intent_v1",
		campaignId: identifier(row.campaign_id),
		sessionId: identifier(row.session_id),
		requestId: identifier(row.request_id),
		profileId: transcriptionProfile(row.profile_id),
		context: localText(row.context),
		glossary: localText(row.glossary),
		contextSha256: sha256(row.context_sha256),
		glossarySha256: sha256(row.glossary_sha256),
		createdAt: isoDate(row.created_at),
		updatedAt: isoDate(row.updated_at),
	};
}

export function parseSessionParticipantMapping(
	value: unknown,
): SessionParticipantMapping {
	const row = record(value);
	if (row.schema_version !== "tda_session_participant_mapping_v1")
		return invalid();
	if (row.policy !== "strong_discord_or_manual_v1") return invalid();
	if (!Array.isArray(row.observations) || row.observations.length > 16384)
		return invalid();
	if (!Array.isArray(row.participants) || row.participants.length > 16384)
		return invalid();
	if (!Array.isArray(row.conflicts) || row.conflicts.length > 32768)
		return invalid();
	if (
		!Array.isArray(row.manual_assignments) ||
		row.manual_assignments.length > 16384
	)
		return invalid();

	const observations = row.observations.map((raw) => {
		const observation = record(raw);
		const observationId = text(observation.observation_id, 32);
		const partId = text(observation.part_id, 32);
		const sourceId = identifier(observation.source_id);
		if (!/^[0-9a-f]{32}$/u.test(observationId)) return invalid();
		if (!/^[0-9a-f]{32}$/u.test(partId)) return invalid();
		if (!/^craig-[0-9a-f]{64}$/u.test(sourceId)) return invalid();
		const trackNumber = nonNegativeInteger(observation.track_number);
		if (trackNumber < 1 || trackNumber > 1_000_000) return invalid();
		return {
			observationId,
			partId,
			sourceId,
			partOrdinal: nonNegativeInteger(observation.part_ordinal),
			trackNumber,
			rawSpeaker: text(observation.raw_speaker, 256),
			username: nullableText(observation.username, 256),
			discriminator: nullableText(observation.discriminator, 64),
			discordId: nullableText(observation.discord_id, 128),
		} satisfies SessionParticipantObservation;
	});
	if (
		new Set(observations.map((row) => row.observationId)).size !==
		observations.length
	)
		return invalid();
	const observationIds = new Set(observations.map((row) => row.observationId));

	const participants = row.participants.map((raw) => {
		const participant = record(raw);
		const participantId = text(participant.participant_id, 32);
		const resolution = text(participant.resolution, 32);
		if (!/^[0-9a-f]{32}$/u.test(participantId)) return invalid();
		if (!["manual", "discord_id", "local_observation"].includes(resolution))
			return invalid();
		if (participant.profile_id !== null) return invalid();
		if (
			!Array.isArray(participant.observation_ids) ||
			participant.observation_ids.length > 16384
		)
			return invalid();
		const participantObservationIds = participant.observation_ids.map((id) => {
			const parsed = text(id, 32);
			if (!/^[0-9a-f]{32}$/u.test(parsed) || !observationIds.has(parsed))
				return invalid();
			return parsed;
		});
		if (
			new Set(participantObservationIds).size !==
			participantObservationIds.length
		)
			return invalid();
		return {
			participantId,
			resolution: resolution as SessionParticipantResolution,
			profileId: null,
			displaySpeaker: text(participant.display_speaker, 256),
			observationIds: participantObservationIds,
		} satisfies SessionParticipant;
	});
	if (
		new Set(participants.map((row) => row.participantId)).size !==
		participants.length
	)
		return invalid();
	const ownedObservations = participants.flatMap((row) => row.observationIds);
	if (
		ownedObservations.length !== observations.length ||
		new Set(ownedObservations).size !== observations.length
	)
		return invalid();

	const conflicts = row.conflicts.map((raw) => {
		const conflict = record(raw);
		const code = text(conflict.code, 96);
		if (!/^[A-Z0-9_]+$/u.test(code)) return invalid();
		const severity = text(conflict.severity, 16);
		if (!["info", "warning", "error"].includes(severity)) return invalid();
		if (
			!Array.isArray(conflict.observation_ids) ||
			conflict.observation_ids.length > 16384
		)
			return invalid();
		const conflictObservationIds = conflict.observation_ids.map((id) => {
			const parsed = text(id, 32);
			if (!/^[0-9a-f]{32}$/u.test(parsed) || !observationIds.has(parsed))
				return invalid();
			return parsed;
		});
		let trackNumber: number | null = null;
		if (conflict.track_number !== null && conflict.track_number !== undefined) {
			trackNumber = nonNegativeInteger(conflict.track_number);
			if (trackNumber < 1 || trackNumber > 1_000_000) return invalid();
		}
		const sourceId =
			conflict.source_id === null || conflict.source_id === undefined
				? null
				: identifier(conflict.source_id);
		if (sourceId !== null && !/^craig-[0-9a-f]{64}$/u.test(sourceId))
			return invalid();
		return {
			code,
			severity: severity as SessionParticipantConflict["severity"],
			requiresResolution: boolean(conflict.requires_resolution),
			observationIds: conflictObservationIds,
			discordId: nullableText(conflict.discord_id, 128),
			labelKey: nullableText(conflict.label_key, 256),
			trackNumber,
			sourceId,
		} satisfies SessionParticipantConflict;
	});

	const manualAssignments = row.manual_assignments.map((raw) => {
		const assignment = record(raw);
		const observationId = text(assignment.observation_id, 32);
		const participantId = text(assignment.participant_id, 32);
		if (
			!observationIds.has(observationId) ||
			!/^[0-9a-f]{32}$/u.test(participantId)
		)
			return invalid();
		return { observationId, participantId } satisfies SessionParticipantAssignment;
	});
	if (
		new Set(manualAssignments.map((row) => row.observationId)).size !==
		manualAssignments.length
	)
		return invalid();

	return {
		schemaVersion: "tda_session_participant_mapping_v1",
		policy: "strong_discord_or_manual_v1",
		campaignId: identifier(row.campaign_id),
		sessionId: identifier(row.session_id),
		workspaceRevision: nonNegativeInteger(row.workspace_revision),
		mappingSha256: sha256(row.mapping_sha256),
		approvalBlocked: boolean(row.approval_blocked),
		observations,
		participants,
		conflicts,
		manualAssignments,
	};
}

export function parseJob(value: unknown): LocalJob {
	const row = record(value);
	if (
		![
			"queued",
			"running",
			"succeeded",
			"failed",
			"cancelled",
			"interrupted",
		].includes(String(row.status))
	)
		return invalid();
	let progress: LocalJob["progress"] = null;
	if (row.progress !== null) {
		const p = record(row.progress);
		if (
			typeof p.completed !== "number" ||
			typeof p.total !== "number" ||
			!Number.isSafeInteger(p.completed) ||
			!Number.isSafeInteger(p.total) ||
			p.completed < 0 ||
			p.total <= 0 ||
			p.completed > p.total
		)
			return invalid();
		progress = {
			completed: p.completed,
			total: p.total,
			unit: text(p.unit, 40),
		};
	}
	const error = row.error === null ? null : record(row.error);
	let context: JobContext | null = null;
	if (row.context !== undefined && row.context !== null) {
		const rawContext = record(row.context);
		const rawDurations = rawContext.track_durations_seconds;
		let trackDurationsSeconds: readonly number[] | undefined;
		if (rawDurations !== undefined) {
			if (!Array.isArray(rawDurations) || rawDurations.length > 256)
				return invalid();
			trackDurationsSeconds = rawDurations.map(nonNegativeNumber);
		}
		const base = {
			campaignId: identifier(rawContext.campaign_id),
			sessionId: identifier(rawContext.session_id),
			sourceId: identifier(rawContext.source_id),
			audioWorkSeconds:
				rawContext.audio_work_seconds === undefined
					? undefined
					: nullableNonNegativeNumber(rawContext.audio_work_seconds),
			trackDurationsSeconds,
		};
		if (rawContext.profile_id !== undefined && rawContext.profile_id !== null) {
			context = { ...base, profileId: transcriptionProfile(rawContext.profile_id) };
		} else if (
			rawContext.sample_identity_sha256 !== undefined ||
			rawContext.sample_seconds !== undefined ||
			rawContext.profiles !== undefined
		) {
			const profiles = rawContext.profiles;
			if (!Array.isArray(profiles) || profiles.length !== 4) return invalid();
			context = {
				...base,
				sampleIdentitySha256:
					rawContext.sample_identity_sha256 === null ||
					rawContext.sample_identity_sha256 === undefined
						? null
						: sha256(rawContext.sample_identity_sha256),
				sampleSeconds:
					rawContext.sample_seconds === null ||
					rawContext.sample_seconds === undefined
						? null
						: nonNegativeNumber(rawContext.sample_seconds),
				profiles: profiles.map(transcriptionProfile),
				prepared: boolean(rawContext.prepared),
			};
		} else {
			context = base;
		}
	}
	const rawTiming =
		row.timing === undefined || row.timing === null ? null : record(row.timing);
	const nullableIso = (raw: unknown) =>
		raw === null || raw === undefined ? null : isoDate(raw);
	const nullableSeconds = (raw: unknown) => {
		if (raw === null || raw === undefined) return null;
		if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return invalid();
		return raw;
	};
	let timing: JobTiming = {
		schemaVersion: "tda_job_timing_v1",
		attemptStartedAt: null,
		attemptFinishedAt: null,
		attemptElapsedSeconds: null,
		stageStartedAt: null,
		stageElapsedSeconds: null,
		tracks: [],
	};
	if (rawTiming) {
		if (rawTiming.schema_version !== "tda_job_timing_v1") return invalid();
		if (!Array.isArray(rawTiming.tracks) || rawTiming.tracks.length > 256) return invalid();
		const tracks: JobTrackTiming[] = rawTiming.tracks.map((value) => {
			const item = record(value);
			const track = nonNegativeInteger(item.track);
			if (track < 1 || track > 256) return invalid();
			const totalTracks =
				item.total_tracks === null || item.total_tracks === undefined
					? null
					: nonNegativeInteger(item.total_tracks);
			if (totalTracks !== null && (totalTracks < track || totalTracks > 256)) return invalid();
			const speaker =
				item.speaker === null || item.speaker === undefined
					? null
					: text(item.speaker, 160);
			return {
				track,
				totalTracks,
				speaker,
				startedAt: isoDate(item.started_at),
				finishedAt: nullableIso(item.finished_at),
				processingSeconds: nullableSeconds(item.processing_seconds),
			};
		});
		if (new Set(tracks.map((item) => item.track)).size !== tracks.length) return invalid();
		timing = {
			schemaVersion: "tda_job_timing_v1",
			attemptStartedAt: nullableIso(rawTiming.attempt_started_at),
			attemptFinishedAt: nullableIso(rawTiming.attempt_finished_at),
			attemptElapsedSeconds: nullableSeconds(rawTiming.attempt_elapsed_seconds),
			stageStartedAt: nullableIso(rawTiming.stage_started_at),
			stageElapsedSeconds: nullableSeconds(rawTiming.stage_elapsed_seconds),
			tracks,
		};
	}
	return {
		timing,
		executionDevice: parseExecutionDevice(row.execution_device),
		id: identifier(row.id),
		kind: text(row.kind),
		status: row.status as JobStatus,
		stage: text(row.stage),
		progress,
		error: error
			? { code: text(error.code), recoverable: boolean(error.recoverable) }
			: null,
		result_available: boolean(row.result_available),
		updated_at: isoDate(row.updated_at),
		attempt:
			row.attempt === undefined ? 0 : nonNegativeInteger(row.attempt),
		context,
	};
}
export function parseJobs(value: unknown): LocalJob[] {
	const rows = record(value).jobs;
	if (!Array.isArray(rows) || rows.length > 1000) return invalid();
	const jobs = rows.map(parseJob);
	if (new Set(jobs.map((job) => job.id)).size !== jobs.length) return invalid();
	return jobs;
}
export function parseJobListPage(value: unknown): JobListPage {
	const row = record(value);
	if (row.schema_version !== "tda_job_page_v1") return invalid();
	if (!["all", "active", "history"].includes(String(row.scope))) return invalid();
	const jobs = parseJobs(row);
	const hasMore = boolean(row.has_more);
	const nextCursor =
		row.next_cursor === null ? null : text(row.next_cursor, 512);
	if (hasMore !== (nextCursor !== null)) return invalid();
	const totalMatching = nonNegativeInteger(row.total_matching);
	if (totalMatching < jobs.length) return invalid();
	const rawCounts = record(row.counts);
	const statuses: readonly JobStatus[] = [
		"queued",
		"running",
		"succeeded",
		"failed",
		"cancelled",
		"interrupted",
	];
	for (const key of Object.keys(rawCounts))
		if (!statuses.includes(key as JobStatus)) return invalid();
	const counts = Object.fromEntries(
		statuses.map((status) => [
			status,
			rawCounts[status] === undefined ? 0 : nonNegativeInteger(rawCounts[status]),
		]),
	) as Record<JobStatus, number>;
	return {
		scope: row.scope as JobListScope,
		jobs,
		hasMore,
		nextCursor,
		totalMatching,
		counts,
	};
}

export function parseJobEvents(value: unknown): JobEvent[] {
	const rows = record(value).events;
	if (!Array.isArray(rows) || rows.length > 200) return invalid();
	const events = rows.map((value) => {
		const row = record(value);
		const level = row.level === undefined ? "info" : text(row.level, 16);
		if (!["info", "warning", "error"].includes(level)) return invalid();
		const rawData =
			row.data === undefined || row.data === null ? {} : record(row.data);
		const entries = Object.entries(rawData);
		if (entries.length > 32) return invalid();
		const data: Record<string, JobEventValue> = {};
		for (const [key, raw] of entries) {
			if (!/^[A-Za-z0-9_-]{1,64}$/u.test(key)) return invalid();
			if (raw === null || typeof raw === "boolean") data[key] = raw;
			else if (typeof raw === "number" && Number.isFinite(raw)) data[key] = raw;
			else if (typeof raw === "string") data[key] = text(raw, 256);
			else return invalid();
		}
		const attempt =
			row.attempt === undefined || row.attempt === null
				? null
				: nonNegativeInteger(row.attempt);
		if (attempt !== null && attempt < 1) return invalid();
		return {
			seq: nonNegativeInteger(row.seq),
			attempt,
			code: text(row.code, 96),
			at: isoDate(row.at),
			level: level as JobEventLevel,
			data,
		};
	});
	if (new Set(events.map((event) => event.seq)).size !== events.length)
		return invalid();
	return events;
}

export function parseJobEventPage(value: unknown): JobEventPage {
	const row = record(value);
	const parsed = parseJobEvents(row);
	const legacy = row.has_more === undefined;
	const events = [...parsed].sort((left, right) => left.seq - right.seq);
	if (legacy) {
		return {
			events,
			hasMore: false,
			nextAfterSeq: events.at(-1)?.seq ?? null,
			nextBeforeSeq: events[0]?.seq ?? null,
		};
	}
	const hasMore = boolean(row.has_more);
	const nextAfterSeq =
		row.next_after_seq === null
			? null
			: nonNegativeInteger(row.next_after_seq);
	const nextBeforeSeq =
		row.next_before_seq === null
			? null
			: nonNegativeInteger(row.next_before_seq);
	if (
		events.length > 0 &&
		(nextAfterSeq !== events.at(-1)?.seq || nextBeforeSeq !== events[0]?.seq)
	)
		return invalid();
	return { events, hasMore, nextAfterSeq, nextBeforeSeq };
}

export function parseJobActivity(value: unknown): JobActivity {
	const row = record(value);
	if (row.schema_version !== "tda_job_activity_v1") return invalid();
	const attempt = nonNegativeInteger(row.attempt);
	if (attempt < 1) return invalid();
	if (!Array.isArray(row.metrics) || row.metrics.length > 1024) return invalid();
	const allowedMetrics: readonly JobActivityMetric[] = [
		"qwen_windows_completed",
		"whisper_segments_completed",
		"model_downloaded_bytes",
	];
	const metrics = row.metrics.map((raw) => {
		const item = record(raw);
		const metric = text(item.metric, 64);
		if (!allowedMetrics.includes(metric as JobActivityMetric)) return invalid();
		const track =
			item.track === null ? null : nonNegativeInteger(item.track);
		if (
			metric === "model_downloaded_bytes"
				? track !== null
				: track === null || track < 1
		)
			return invalid();
		return {
			track,
			metric: metric as JobActivityMetric,
			value: nonNegativeInteger(item.value),
			updatedAt: isoDate(item.updated_at),
		};
	});
	const identities = metrics.map(
		(item) => `${item.metric}:${item.track === null ? "none" : item.track}`,
	);
	if (new Set(identities).size !== identities.length) return invalid();
	return {
		schemaVersion: "tda_job_activity_v1",
		attempt,
		metrics,
	};
}

export function parseExecutionDevice(value: unknown): ExecutionDevice | null {
 if (value === null || value === undefined) return null;
 const row = record(value);
 if (row.kind === "cpu") return { kind: "cpu", logicalIndex: null, physicalUuid: null, pciBusId: null };
 if (row.kind !== "cuda") return invalid();
 const logicalIndex = nonNegativeInteger(row.logical_index); if (logicalIndex > 99) return invalid();
 return { kind: "cuda", logicalIndex, physicalUuid: parseGpuUuid(row.physical_uuid), pciBusId: parsePciBusId(row.pci_bus_id) };
}
function parseGpuUuid(value: unknown): string | null {
 if (value === null || value === undefined) return null;
 if (typeof value !== "string" || !/^(GPU|MIG)-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) return invalid();
 const offset = value.indexOf("-"); return value.slice(0, offset).toUpperCase() + value.slice(offset).toLowerCase();
}
function parsePciBusId(value: unknown): string | null {
 if (value === null || value === undefined) return null;
 if (typeof value !== "string" || !/^[0-9a-f]{8}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/iu.test(value)) return invalid();
 return value.toLowerCase();
}
export function parseSystemSnapshot(value: unknown): SystemSnapshot {
	const row = record(value);
	const host = record(row.host);
	const cpu = record(row.cpu);
	const memory = record(row.memory);
	if (!Array.isArray(row.gpus) || row.gpus.length > 16) return invalid();
	const gpus = row.gpus.map((value) => {
		const gpu = record(value);
		return {
			uuid: parseGpuUuid(gpu.uuid),
			pciBusId: parsePciBusId(gpu.pci_bus_id),
			index: nonNegativeInteger(gpu.index),
			name: text(gpu.name, 160),
			utilizationPercent: nullablePercent(gpu.utilization_percent),
			memoryUsedBytes: nullableNonNegativeNumber(gpu.memory_used_bytes),
			memoryTotalBytes: nullableNonNegativeNumber(gpu.memory_total_bytes),
		};
	});
	return {
		sampledAt: isoDate(row.sampled_at),
		host: {
			os: text(host.os, 160),
			cpu: nullableText(host.cpu),
		},
		cpu: { utilizationPercent: nullablePercent(cpu.utilization_percent) },
		memory: {
			usedBytes: nullableNonNegativeNumber(memory.used_bytes),
			totalBytes: nullableNonNegativeNumber(memory.total_bytes),
			percent: nullablePercent(memory.percent),
		},
		gpus,
	};
}
// Only identity/hashes are retained. Transcript text and local artifact content never enter the cloud UI bridge.
export function parseLocalSources(value: unknown): LocalSourceSummary[] {
	const row = record(value);
	if (row.schema_version !== "tda_craig_sources_v1") return invalid();
	if (!Array.isArray(row.sources) || row.sources.length > 1000) return invalid();
	const sources = row.sources.map((raw) => {
		const item = record(raw);
		const sourceSha256 = sha256(item.source_sha256);
		const sourceId = identifier(item.source_id);
		if (sourceId !== `craig-${sourceSha256}`) return invalid();
		const trackCount = nonNegativeInteger(item.track_count);
		if (trackCount < 1 || trackCount > 256) return invalid();
		return {
			sourceId,
			sourceSha256,
			recordingId: nullableText(item.recording_id, 256),
			trackCount,
		};
	});
	if (new Set(sources.map((item) => item.sourceId)).size !== sources.length)
		return invalid();
	return sources;
}


function parseExecutionLineage(value: unknown): LocalExecutionLineage | null {
	if (value === null || value === undefined) return null;
	const row = record(value);
	if (row.schema_version !== "tda_execution_lineage_v1") return invalid();
	let runtimeArtifact: LocalExecutionLineage["runtimeArtifact"] = null;
    if (row.runtime_artifact !== null && row.runtime_artifact !== undefined) {
        const artifact = record(row.runtime_artifact);
        const expectedId = row.runtime_family === "qwen" ? "qwen3-transformers" : row.runtime_family === "whisper" ? "whisper-ctranslate2" : null;
        if (!expectedId || artifact.runtime_id !== expectedId || artifact.version !== row.runtime_version || typeof artifact.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(artifact.version)) return invalid();
        runtimeArtifact = { runtimeId: expectedId, version: text(artifact.version), workerSha256: sha256(artifact.worker_sha256), archiveSha256: artifact.archive_sha256 === null ? null : sha256(artifact.archive_sha256) };
    }
	const rawGpu = row.gpu;
	let gpu: LocalExecutionLineage["gpu"] = null;
	if (rawGpu !== null && rawGpu !== undefined) {
		const item = record(rawGpu);
		gpu = {
			vendor: nullableText(item.vendor, 64),
			index:
				item.index === null || item.index === undefined
					? null
					: nonNegativeInteger(item.index),
			model: nullableText(item.model, 160),
			vramTotalBytes: nullableNonNegativeNumber(item.vram_total_bytes),
			computeCapability: nullableText(item.compute_capability, 32),
			driverVersion: nullableText(item.driver_version, 64),
		};
	}
	return {
		schemaVersion: "tda_execution_lineage_v1",
		companionVersion: nullableText(row.companion_version, 64),
		runtimeArtifact,
		executionDevice: parseExecutionDevice(row.execution_device),
		runtimeFamily: nullableText(row.runtime_family, 64),
		runtimeVersion: nullableText(row.runtime_version, 128),
		device: nullableText(row.device, 64),
		computeType: nullableText(row.compute_type, 64),
		gpu,
	};
}

function parsePublicationTarget(
	value: unknown,
	expected: {
		sourceId: string;
		runId: string;
		transcriptSha256: string;
	},
): LocalPublicationTarget | null {
	if (value === null || value === undefined) return null;
	const row = record(value);
	if (row.schema_version !== "tda_publication_target_v1") return invalid();
	const sourceId = identifier(row.source_id);
	const runId = runIdentifier(row.run_id);
	const transcriptSha256 = sha256(row.transcript_sha256);
	const attempt = nonNegativeInteger(row.attempt);
	if (
		attempt < 1 ||
		sourceId !== expected.sourceId ||
		runId !== expected.runId ||
		transcriptSha256 !== expected.transcriptSha256
	)
		return invalid();
	return {
		campaignSlug: identifier(row.campaign_slug),
		sourceSessionId: identifier(row.source_session_id),
		jobId: identifier(row.job_id),
		attempt,
	};
}

function parseLocalRunReview(value: unknown): LocalRunReviewSummary | null {
	if (value === null || value === undefined) return null;
	const row = record(value);
	const status = String(row.status);
	if (status === "unknown") {
		if (
			row.draft_revision !== null ||
			row.review_percent !== null ||
			row.updated_at !== null
		)
			return invalid();
		return {
			status: "unknown",
			draftRevision: null,
			reviewPercent: null,
			updatedAt: null,
		};
	}
	if (!["draft", "reviewed", "approved_local"].includes(status)) return invalid();
	const reviewPercent = nonNegativeNumber(row.review_percent);
	if (reviewPercent > 100) return invalid();
	const updatedAt = nullableIsoDate(row.updated_at);
	if (updatedAt === null) return invalid();
	return {
		status: status as LocalReviewStatus,
		draftRevision: nonNegativeInteger(row.draft_revision),
		reviewPercent,
		updatedAt,
	};
}

export function parseLocalRunDeleteReceipt(value: unknown): LocalRunDeleteReceipt {
	const row = record(value);
	if (
		row.schema_version !== "tda_local_run_delete_receipt_v1" ||
		row.deleted !== true ||
		row.cloud_changed !== false
	) return invalid();
	return {
		schemaVersion: "tda_local_run_delete_receipt_v1",
		sourceId: identifier(row.source_id),
		runId: runIdentifier(row.run_id),
		transcriptSha256: sha256(row.transcript_sha256),
		deleted: true,
		reviewDeleted: boolean(row.review_deleted),
		cloudChanged: false,
		deletedAt: isoDate(row.deleted_at),
	};
}

export function parseLocalRunCatalogPage(value: unknown): LocalRunCatalogPage {
	const row = record(value);
	if (row.schema_version !== "tda_local_run_catalog_v1") return invalid();
	if (!Array.isArray(row.runs) || row.runs.length > 200) return invalid();
	const grouped = new Map<string, unknown[]>();
	for (const raw of row.runs) {
		const item = record(raw);
		const sourceId = identifier(item.source_id);
		const values = grouped.get(sourceId) ?? [];
		values.push(raw);
		grouped.set(sourceId, values);
	}
	const runs = [...grouped.entries()].flatMap(([sourceId, values]) =>
		parseLocalRuns({
			schema_version: "tda_transcription_runs_v1",
			source_id: sourceId,
			runs: values,
		}),
	);
	const identities = runs.map((run) => `${run.sourceId}:${run.runId}`);
	if (new Set(identities).size !== identities.length) return invalid();
	const hasMore = boolean(row.has_more);
	const nextCursor = row.next_cursor === null ? null : text(row.next_cursor, 512);
	if (hasMore !== (nextCursor !== null)) return invalid();
	return { runs, hasMore, nextCursor };
}

export function parseLocalRuns(value: unknown): LocalRunSummary[] {
	const row = record(value);
	if (row.schema_version !== "tda_transcription_runs_v1") return invalid();
	const sourceId = identifier(row.source_id);
	if (!Array.isArray(row.runs) || row.runs.length > 1000) return invalid();
	return row.runs.map((raw) => {
		const item = record(raw);
		if (item.status !== "completed") return invalid();
		if (identifier(item.source_id) !== sourceId) return invalid();
		const runId = runIdentifier(item.run_id);
		const transcriptSha256 = sha256(item.transcript_sha256);
		const stats = record(item.stats ?? {});
		const nullableMetric = (metric: unknown) =>
			metric === null || metric === undefined ? null : nonNegativeNumber(metric);
		const nullableCount = (metric: unknown) =>
			metric === null || metric === undefined ? null : nonNegativeInteger(metric);
		return {
			runId,
			sourceId,
			profileId: text(item.profile_id, 64),
			engine: nullableText(item.engine, 64),
			model: nullableText(item.model, 256),
			modelRevision: nullableText(item.model_revision, 256),
			device: nullableText(item.device, 64),
			computeType: nullableText(item.compute_type, 64),
			alignment: nullableText(item.alignment, 128),
			executionLineage: parseExecutionLineage(item.execution_lineage),
			language: nullableText(item.language, 32),
			completedAt: nullableIsoDate(item.completed_at),
			transcriptSha256,
			transcriptSizeBytes: (() => {
				const size = nonNegativeInteger(item.transcript_size_bytes);
				if (size < 1) return invalid();
				return size;
			})(),
			stats: {
				audioWorkSeconds: nullableMetric(stats.audio_work_seconds),
				processingSeconds: nullableMetric(stats.processing_seconds),
				processingMetrics: parseEngineMetrics(stats.processing_metrics, stats.track_count, stats.audio_work_seconds),
				sessionDurationSeconds: nullableMetric(stats.session_duration_seconds),
				...(stats.duration_semantics === "session_extent_v1"
					? { durationSemantics: "session_extent_v1" as const }
					: {}),
				rtf: nullableMetric(stats.rtf),
				wordCount: nullableCount(stats.word_count),
				segmentCount: nullableCount(stats.segment_count),
				trackCount: nullableCount(stats.track_count),
				turnCount: nullableCount(stats.turn_count),
				deduplicatedSegmentCount: nullableCount(
					stats.deduplicated_segment_count,
				),
				warningCount: nullableCount(stats.warning_count),
			},
			publicationTarget: parsePublicationTarget(item.publication_target, {
				sourceId,
				runId,
				transcriptSha256,
			}),
			review: parseLocalRunReview(item.review),
		};
	});
}

export function parseLocalReview(
	value: unknown,
	options: Readonly<{ requireAbsoluteTimeline?: boolean }> = {},
): LocalReview {
	const row = record(value);
	if (row.schema_version !== "tda_local_review_v1") return invalid();
	const status = text(row.status, 32);
	if (!["draft", "reviewed", "approved_local"].includes(status)) return invalid();
	const approvalCurrent =
		row.approval_current === undefined ? false : boolean(row.approval_current);
	const approvedAt =
		row.approved_at === undefined || row.approved_at === null
			? null
			: isoDate(row.approved_at);
	if (status === "approved_local" && !approvalCurrent) return invalid();
	if (approvalCurrent !== (approvedAt !== null)) return invalid();
	const sourceId = identifier(row.source_id);
	const runId = runIdentifier(row.run_id);
	const baseTranscriptSha256 = sha256(row.base_transcript_sha256);
	const supportsCas = row.snapshot_contract === "tda_local_review_cas_v1";
	if (row.snapshot_contract !== undefined && !supportsCas) return invalid();
	const ephemeral = supportsCas && row.persistence === "ephemeral_base";
	if (supportsCas && !["persisted", "ephemeral_base"].includes(String(row.persistence))) return invalid();
	if (ephemeral && (row.draft_revision !== null || row.draft_sha256 !== null ||
		row.created_at !== null || row.updated_at !== null || status !== "draft")) return invalid();
	if (!supportsCas && row.persistence !== undefined) return invalid();
	const lineage = record(row.lineage);
	const stats = record(row.stats);
	const review = record(row.review);
	const sync = record(row.sync);
	if (sync.status !== "not_configured") return invalid();
	if (!Array.isArray(row.warnings) || row.warnings.length > 1000) return invalid();
	if (!Array.isArray(row.segments) || row.segments.length > 100_000) return invalid();
	const segments = row.segments.map((raw) => {
		const segment = record(raw);
		const start = nonNegativeNumber(segment.start);
		const end = nonNegativeNumber(segment.end);
		if (end < start) return invalid();
		const hasTimelineStart = segment.timeline_start !== undefined;
		const hasTimelineEnd = segment.timeline_end !== undefined;
		if (
			options.requireAbsoluteTimeline &&
			(!hasTimelineStart || !hasTimelineEnd)
		)
			return invalid();
		const timelineStart = hasTimelineStart
			? nonNegativeNumber(segment.timeline_start)
			: start;
		const timelineEnd = hasTimelineEnd
			? nonNegativeNumber(segment.timeline_end)
			: end;
		if (timelineEnd < timelineStart) return invalid();
		const trackNumber = nonNegativeInteger(segment.track_number);
		if (trackNumber < 1) return invalid();
		let absoluteTime: TrustedAbsoluteTime | null | undefined;
		if (segment.absolute_time_state !== undefined) {
			if (segment.absolute_time_state === "trusted_absolute") {
				absoluteTime = parseTrustedAbsoluteTime({
					state: segment.absolute_time_state,
					start: segment.absolute_start,
					end: segment.absolute_end,
					source: segment.absolute_time_source,
				});
				if (!absoluteTime) return invalid();
			} else if (segment.absolute_time_state === "unavailable") {
				if (
					(segment.absolute_start !== null && segment.absolute_start !== undefined) ||
					(segment.absolute_end !== null && segment.absolute_end !== undefined) ||
					(segment.absolute_time_source !== null && segment.absolute_time_source !== undefined)
				)
					return invalid();
				absoluteTime = null;
			} else return invalid();
		}
		return {
			trackNumber,
			segmentId: contentText(segment.segment_id, 256),
			start,
			end,
			timelineStart,
			timelineEnd,
			...(absoluteTime !== undefined ? { absoluteTime } : {}),
			text: isReviewStringV1(segment.text, "text") ? segment.text : invalid(),
			speaker: isReviewStringV1(segment.speaker, "speaker") ? segment.speaker : invalid(),
			reviewed: boolean(segment.reviewed),
		};
	});
	const totalSegments = nonNegativeInteger(review.total_segments);
	const reviewedSegments = nonNegativeInteger(review.reviewed_segments);
	if (totalSegments !== segments.length || reviewedSegments > totalSegments)
		return invalid();
	const reviewPercent = nonNegativeNumber(review.review_percent);
	if (reviewPercent > 100) return invalid();
	const warningCount = nonNegativeInteger(review.warning_count);
	let warningSummary: LocalReview["warningSummary"];
	if (row.warning_summary !== undefined) {
		const summary = record(row.warning_summary);
		const totalCount = nonNegativeInteger(summary.total_count);
		const displayedCount = nonNegativeInteger(summary.displayed_count);
		const truncated = boolean(summary.truncated);
		if (totalCount !== warningCount || displayedCount !== row.warnings.length ||
			displayedCount !== Math.min(totalCount, 1000) || truncated !== (totalCount > displayedCount)) return invalid();
		warningSummary = { totalCount, displayedCount, truncated };
	}
	return {
		sourceId,
		runId,
		baseTranscriptSha256,
		draftRevision: ephemeral ? null : nonNegativeInteger(row.draft_revision),
		draftSha256: ephemeral ? null : sha256(row.draft_sha256),
		persistence: ephemeral ? "ephemeral_base" : "persisted",
		...(supportsCas ? { snapshotContract: "tda_local_review_cas_v1" as const } : {}),
		status: status as LocalReviewStatus,
		approvalCurrent,
		approvedAt,
		createdAt: ephemeral ? null : isoDate(row.created_at),
		updatedAt: ephemeral ? null : isoDate(row.updated_at),
		lineage: {
			profileId: text(lineage.profile_id, 64),
			engine: nullableText(lineage.engine, 64),
			model: nullableText(lineage.model, 256),
			modelRevision: nullableText(lineage.model_revision, 256),
			device: nullableText(lineage.device, 64),
			computeType: nullableText(lineage.compute_type, 64),
			alignment: nullableText(lineage.alignment, 128),
			executionLineage: parseExecutionLineage(lineage.execution_lineage),
			completedAt: nullableIsoDate(lineage.completed_at),
		},
		stats: {
			audioWorkSeconds: nullableNonNegativeNumber(stats.audio_work_seconds),
			processingSeconds: nullableNonNegativeNumber(stats.processing_seconds),
			processingMetrics: parseEngineMetrics(stats.processing_metrics, stats.track_count, stats.audio_work_seconds),
			sessionDurationSeconds: nullableNonNegativeNumber(stats.session_duration_seconds),
			...(stats.duration_semantics === "session_extent_v1"
				? { durationSemantics: "session_extent_v1" as const }
				: {}),
			rtf: nullableNonNegativeNumber(stats.rtf),
			wordCount:
				stats.word_count === null || stats.word_count === undefined
					? null
					: nonNegativeInteger(stats.word_count),
			segmentCount:
				stats.segment_count === null || stats.segment_count === undefined
					? null
					: nonNegativeInteger(stats.segment_count),
			trackCount:
				stats.track_count === null || stats.track_count === undefined
					? null
					: nonNegativeInteger(stats.track_count),
		},
		warnings: row.warnings.map((warning) => contentText(warning, 1024)),
		...(warningSummary ? { warningSummary } : {}),
		...(row.publication_target_state === "valid" || row.publication_target_state === "invalid" || row.publication_target_state === "unbound"
			? { publicationTargetState: row.publication_target_state } : {}),
		publicationTarget: parsePublicationTarget(row.publication_target, {
			sourceId,
			runId,
			transcriptSha256: baseTranscriptSha256,
		}),
		review: {
			reviewedSegments,
			totalSegments,
			reviewPercent,
			editedSegments: nonNegativeInteger(review.edited_segments),
			wordCount: nonNegativeInteger(review.word_count),
			warningCount,
		},
		segments,
		sync: { status: "not_configured" },
	};
}

export function parseBenchmarkResult(
	value: unknown,
	jobId: string,
): BenchmarkResult {
	const row = record(value);
	if (row.schema_version !== "tda_processing_benchmark_v1")
		throw new BridgeError("incompatible");
	if (identifier(row.job_id) !== jobId) return invalid();
	if (row.kind !== "benchmark.craig") return invalid();
	const sampleSeconds = nonNegativeNumber(row.sample_seconds);
	if (sampleSeconds !== 300) return invalid();
	const bundleFieldsPresent =
		row.benchmark_id !== undefined ||
		row.bundle_manifest_sha256 !== undefined ||
		row.bundle_size_bytes !== undefined;
	let benchmarkId: string | null = null;
	let bundleManifestSha256: string | null = null;
	let bundleSizeBytes: number | null = null;
	if (bundleFieldsPresent) {
		benchmarkId = text(row.benchmark_id, 196);
		if (!/^benchmark-[A-Za-z0-9_-]{1,128}-a[1-9][0-9]{0,5}$/u.test(benchmarkId))
			return invalid();
		bundleManifestSha256 = sha256(row.bundle_manifest_sha256);
		bundleSizeBytes = nonNegativeInteger(row.bundle_size_bytes);
		if (bundleSizeBytes <= 0) return invalid();
	}
	const profiles = row.profiles;
	if (!Array.isArray(profiles) || profiles.length !== 4) return invalid();
	const parsed = profiles.map((raw): BenchmarkProfileResult => {
		const item = record(raw);
		if (item.schema_version !== "tda_benchmark_profile_v1") return invalid();
		const engine = text(item.engine, 64);
		if (engine !== "whisper" && engine !== "qwen3") return invalid();
		const rtf =
			item.rtf === null || item.rtf === undefined
				? null
				: nonNegativeNumber(item.rtf);
		const executionLineage = parseExecutionLineage(item.execution_lineage);
		const expectedRuntimeFamily = engine === "whisper" ? "whisper" : "qwen";
		if (
			!executionLineage ||
			executionLineage.runtimeFamily !== expectedRuntimeFamily ||
			!executionLineage.runtimeArtifact?.archiveSha256 ||
			!executionLineage.device?.toLowerCase().startsWith("cuda") ||
			executionLineage.gpu?.vendor !== "NVIDIA" ||
			!executionLineage.gpu.model
		)
			return invalid();
		let transcriptSha256: string | null = null;
		let transcriptSizeBytes: number | null = null;
		let artifactAvailable = false;
		const profileArtifactFieldsPresent =
			item.artifact_available !== undefined ||
			item.transcript_sha256 !== undefined ||
			item.transcript_size_bytes !== undefined ||
			item.benchmark_id !== undefined;
		if (bundleFieldsPresent) {
			if (
				item.artifact_available !== true ||
				item.benchmark_id !== benchmarkId ||
				item.sample_identity_sha256 !== row.sample_identity_sha256
			)
				return invalid();
			transcriptSha256 = sha256(item.transcript_sha256);
			transcriptSizeBytes = nonNegativeInteger(item.transcript_size_bytes);
			if (transcriptSizeBytes <= 0) return invalid();
			artifactAvailable = true;
		} else if (profileArtifactFieldsPresent) {
			return invalid();
		}
		return {
			profileId: transcriptionProfile(item.profile_id),
			engine,
			model: text(item.model, 256),
			modelRevision: nullableText(item.model_revision, 256),
			device: text(item.device, 64),
			computeType: nullableText(item.compute_type, 64),
			alignment: text(item.alignment, 128),
			sampleSeconds: nonNegativeNumber(item.sample_seconds),
			audioWorkSeconds: nonNegativeNumber(item.audio_work_seconds),
			sessionDurationSeconds: nonNegativeNumber(item.session_duration_seconds),
			processingTimingVersion:
				item.processing_timing_version === PROCESSING_TIMING_VERSION
					? PROCESSING_TIMING_VERSION
					: invalid(),
			processingSeconds: nonNegativeNumber(item.processing_seconds),
			rtf,
			wordCount: nonNegativeInteger(item.word_count),
			segmentCount: nonNegativeInteger(item.segment_count),
			trackCount: nonNegativeInteger(item.track_count),
			warningCount: nonNegativeInteger(item.warning_count),
			executionLineage,
			transcriptSha256,
			transcriptSizeBytes,
			artifactAvailable,
		};
	});
	const expected: readonly TranscriptionProfileId[] = [
		"whisper-turbo",
		"whisper-detailed",
		"qwen-fast",
		"qwen-quality",
	];
	if (parsed.some((item, index) => item.profileId !== expected[index]))
		return invalid();
	return {
		schemaVersion: "tda_processing_benchmark_v1",
		jobId,
		sourceId: identifier(row.source_id),
		campaignId: identifier(row.campaign_id),
		sessionId: identifier(row.session_id),
		sampleIdentitySha256: sha256(row.sample_identity_sha256),
		sampleSeconds,
		executionMode:
			row.execution_mode === "prepared_artifacts_fresh_worker_per_profile_v1"
				? row.execution_mode
				: invalid(),
		trackCount: nonNegativeInteger(row.track_count),
		audioWorkSeconds: nonNegativeNumber(row.audio_work_seconds),
		prepared: boolean(row.prepared),
		benchmarkId,
		bundleManifestSha256,
		bundleSizeBytes,
		profiles: parsed,
	};
}

export function parseResultSummary(
	value: unknown,
	jobId: string,
): ResultSummary {
	const row = record(value);
	if (row.schema_version !== "tda_local_result_v1")
		throw new BridgeError("incompatible");
	if (row.job_id !== jobId) return invalid();
	if (record(row.sync).status !== "not_configured") return invalid();

	const base = {
		jobId: identifier(row.job_id),
		campaignId: identifier(row.campaign_id),
		sessionId: identifier(row.session_id),
		sourceId: identifier(row.source_id),
	};
	if (row.publication_bundle !== undefined && row.publication_bundle !== null) {
		const bundle = record(row.publication_bundle);
		if (bundle.schema_version !== "publication_bundle_v1")
			throw new BridgeError("incompatible");
		return { ...base, publicationId: sha256(bundle.publication_id) };
	}
	if (row.transcription !== undefined && row.transcription !== null) {
		const transcription = record(row.transcription);
		if (transcription.schema_version !== "tda_transcript_v1")
			throw new BridgeError("incompatible");
		if (transcription.artifact !== "transcript.json") return invalid();
		const transcriptSha256 = sha256(transcription.sha256);
		const runId = text(transcription.run_id, 196);
		if (!/^[A-Za-z0-9_-]{1,196}$/u.test(runId)) return invalid();
		return {
			...base,
			publicationId: transcriptSha256,
			profileId: transcriptionProfile(transcription.profile_id),
			transcriptSha256,
			runId,
		};
	}
	return invalid();
}
