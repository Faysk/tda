import type { CraigSource, TranscriptionProfileId } from "./protocol";

const PREFIX = "tda.processing.session-intent-recovery.v1";
const PROFILES = new Set<TranscriptionProfileId>([
	"whisper-turbo",
	"whisper-detailed",
	"qwen-fast",
	"qwen-quality",
]);
const SOURCE_ID = /^craig-[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const MAX_SOURCES = 64;
const MAX_CONTEXT = 4_096;
const MAX_GLOSSARY = 4_096;
const MAX_LABEL = 512;

export type RecoverableSessionIntent = Readonly<{
	sessionId: string;
	sources: readonly Readonly<{ source: CraigSource; label: string }>[];
	profile: TranscriptionProfileId;
	context: string;
	glossary: string;
}>;

export type SessionIntentRecovery = Readonly<{
	intent: RecoverableSessionIntent;
	jobIds: ReadonlyMap<string, string>;
	runIds: ReadonlyMap<string, string>;
}>;

type StoredReceipt = {
	schema_version: "tda_session_intent_recovery_v1";
	session_id: string;
	profile: TranscriptionProfileId;
	context: string;
	glossary: string;
	sources: Array<{ source: CraigSource; label: string }>;
	job_ids: Array<[string, string]>;
	run_ids: Array<[string, string]>;
};

function key(scope: string, sessionId: string): string | null {
	if (!scope || scope.length > 256 || !SESSION_ID.test(sessionId)) return null;
	return `${PREFIX}:${encodeURIComponent(scope)}:${sessionId}`;
}

function finite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function source(value: unknown): CraigSource | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;
	if (
		row.schemaVersion !== "tda_craig_ingest_v1" ||
		typeof row.sourceId !== "string" ||
		!SOURCE_ID.test(row.sourceId) ||
		typeof row.sourceSha256 !== "string" ||
		!SHA256.test(row.sourceSha256) ||
		typeof row.sizeBytes !== "number" ||
		!Number.isSafeInteger(row.sizeBytes) ||
		row.sizeBytes < 0 ||
		typeof row.trackCount !== "number" ||
		!Number.isSafeInteger(row.trackCount) ||
		row.trackCount < 0 ||
		typeof row.reused !== "boolean"
	)
		return null;
	const recordingId =
		row.recordingId === undefined || row.recordingId === null
			? null
			: typeof row.recordingId === "string" && row.recordingId.length <= 256
				? row.recordingId
				: undefined;
	if (recordingId === undefined) return null;
	const nullableFinite = (input: unknown) =>
		input === null ? null : finite(input) ? input : undefined;
	const audioWorkSeconds = nullableFinite(row.audioWorkSeconds);
	const sessionDurationSeconds = nullableFinite(row.sessionDurationSeconds);
	const minimumTrackDurationSeconds = nullableFinite(row.minimumTrackDurationSeconds);
	if (
		audioWorkSeconds === undefined ||
		sessionDurationSeconds === undefined ||
		minimumTrackDurationSeconds === undefined
	)
		return null;
	return {
		schemaVersion: "tda_craig_ingest_v1",
		sourceId: row.sourceId,
		sourceSha256: row.sourceSha256,
		recordingId,
		sizeBytes: row.sizeBytes,
		trackCount: row.trackCount,
		audioWorkSeconds,
		sessionDurationSeconds,
		minimumTrackDurationSeconds,
		reused: row.reused,
	};
}

function identityPairs(value: unknown, sourceIds: ReadonlySet<string>): Map<string, string> | null {
	if (!Array.isArray(value) || value.length > MAX_SOURCES) return null;
	const result = new Map<string, string>();
	for (const pair of value) {
		if (
			!Array.isArray(pair) ||
			pair.length !== 2 ||
			typeof pair[0] !== "string" ||
			!sourceIds.has(pair[0]) ||
			typeof pair[1] !== "string" ||
			pair[1].length < 1 ||
			pair[1].length > 196 ||
			result.has(pair[0])
		)
			return null;
		result.set(pair[0], pair[1]);
	}
	return result;
}

export function saveSessionIntentRecovery(
	storage: Storage,
	scope: string | null,
	intent: RecoverableSessionIntent,
	jobIds: ReadonlyMap<string, string> = new Map(),
	runIds: ReadonlyMap<string, string> = new Map(),
): void {
	if (!scope) return;
	const storageKey = key(scope, intent.sessionId);
	if (!storageKey) return;
	const receipt: StoredReceipt = {
		schema_version: "tda_session_intent_recovery_v1",
		session_id: intent.sessionId,
		profile: intent.profile,
		context: intent.context,
		glossary: intent.glossary,
		sources: intent.sources.map((item) => ({
			source: { ...item.source },
			label: item.label,
		})),
		job_ids: [...jobIds],
		run_ids: [...runIds],
	};
	storage.setItem(storageKey, JSON.stringify(receipt));
}

export function loadSessionIntentRecovery(
	storage: Storage,
	scope: string | null,
	sessionId: string,
): SessionIntentRecovery | null {
	if (!scope) return null;
	const storageKey = key(scope, sessionId);
	if (!storageKey) return null;
	let parsed: unknown;
	try {
		const raw = storage.getItem(storageKey);
		if (!raw || raw.length > 64 * 1024) return null;
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const row = parsed as Record<string, unknown>;
	if (
		row.schema_version !== "tda_session_intent_recovery_v1" ||
		row.session_id !== sessionId ||
		typeof row.profile !== "string" ||
		!PROFILES.has(row.profile as TranscriptionProfileId) ||
		typeof row.context !== "string" ||
		row.context.length > MAX_CONTEXT ||
		typeof row.glossary !== "string" ||
		row.glossary.length > MAX_GLOSSARY ||
		!Array.isArray(row.sources) ||
		row.sources.length < 1 ||
		row.sources.length > MAX_SOURCES
	)
		return null;
	const seen = new Set<string>();
	const sources: Array<{ source: CraigSource; label: string }> = [];
	for (const value of row.sources) {
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		const item = value as Record<string, unknown>;
		const parsedSource = source(item.source);
		if (
			!parsedSource ||
			seen.has(parsedSource.sourceId) ||
			typeof item.label !== "string" ||
			item.label.length < 1 ||
			item.label.length > MAX_LABEL
		)
			return null;
		seen.add(parsedSource.sourceId);
		sources.push({ source: parsedSource, label: item.label });
	}
	const jobIds = identityPairs(row.job_ids, seen);
	const runIds = identityPairs(row.run_ids, seen);
	if (!jobIds || !runIds) return null;
	return {
		intent: {
			sessionId,
			sources,
			profile: row.profile as TranscriptionProfileId,
			context: row.context,
			glossary: row.glossary,
		},
		jobIds,
		runIds,
	};
}

export function clearSessionIntentRecovery(
	storage: Storage,
	scope: string | null,
	sessionId: string,
): void {
	if (!scope) return;
	const storageKey = key(scope, sessionId);
	if (storageKey) storage.removeItem(storageKey);
}
