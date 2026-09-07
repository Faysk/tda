export const LOCAL_API = "http://127.0.0.1:8765/api/v1";
export type Lifecycle = "preparing" | "ready" | "paused";
export type Health = {
	api_version: "1";
	service_version: string;
	lifecycle: Lifecycle;
};
export type Capabilities = {
	capabilities: string[];
	sync: boolean;
	device: { id: string; label: string };
};
export type JobStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "interrupted";
export type LocalJob = {
	id: string;
	kind: string;
	status: JobStatus;
	stage: string;
	progress: null | { completed: number; total: number; unit: string };
	error: null | { code: string; recoverable: boolean };
	result_available: boolean;
	updated_at: string;
};
export type ResultSummary = {
	jobId: string;
	campaignId: string;
	sessionId: string;
	sourceId: string;
	publicationId: string;
};
export type BridgeErrorCode =
	| "unreachable"
	| "unauthorized"
	| "forbidden"
	| "incompatible"
	| "invalid_response"
	| "timeout"
	| "conflict"
	| "service_error";
export class BridgeError extends Error {
	constructor(public readonly code: BridgeErrorCode) {
		super(code);
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
export function identifier(value: unknown): string {
	const id = text(value);
	if (!/^[A-Za-z0-9_-]+$/u.test(id)) return invalid();
	return id;
}
function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") return invalid();
	return value;
}
export function parseHealth(value: unknown): Health {
	const row = record(value);
	if (row.api_version !== "1") throw new BridgeError("incompatible");
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
	return {
		capabilities: row.capabilities.map((value) => text(value)),
		sync: boolean(row.sync),
		device: { id: identifier(device.id), label: text(device.label) },
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
	const updated = text(row.updated_at);
	if (!Number.isFinite(Date.parse(updated))) return invalid();
	return {
		id: identifier(row.id),
		kind: text(row.kind),
		status: row.status as JobStatus,
		stage: text(row.stage),
		progress,
		error: error
			? { code: text(error.code), recoverable: boolean(error.recoverable) }
			: null,
		result_available: boolean(row.result_available),
		updated_at: updated,
	};
}
export function parseJobs(value: unknown): LocalJob[] {
	const rows = record(value).jobs;
	if (!Array.isArray(rows) || rows.length > 1000) return invalid();
	const jobs = rows.map(parseJob);
	if (new Set(jobs.map((job) => job.id)).size !== jobs.length) return invalid();
	return jobs;
}
// Only a small identity projection is retained. No bundle content is displayed or sent to cloud.
export function parseResultSummary(
	value: unknown,
	jobId: string,
): ResultSummary {
	const row = record(value);
	if (row.schema_version !== "tda_local_result_v1")
		throw new BridgeError("incompatible");
	if (row.job_id !== jobId) return invalid();
	const bundle = record(row.publication_bundle);
	if (bundle.schema_version !== "publication_bundle_v1")
		throw new BridgeError("incompatible");
	if (record(row.sync).status !== "not_configured") return invalid();
	const publicationId = text(bundle.publication_id);
	if (!/^[a-f0-9]{64}$/u.test(publicationId)) return invalid();
	return {
		jobId: identifier(row.job_id),
		campaignId: identifier(row.campaign_id),
		sessionId: identifier(row.session_id),
		sourceId: identifier(row.source_id),
		publicationId,
	};
}
