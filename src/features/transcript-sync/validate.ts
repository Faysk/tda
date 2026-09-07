import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
	IMPORT_VERSION,
	MAX_IMPORT_BYTES,
	MAX_SEGMENTS,
	SHA256,
	UUID,
	type ImportFailure,
	type PreparedImport,
} from "./contract";

class Invalid extends Error {
	constructor(readonly reason: ImportFailure = "invalid_payload") {
		super(reason);
	}
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Invalid();
	return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
	if (Object.keys(value).some((key) => !allowed.includes(key)))
		throw new Invalid();
}
function string(value: unknown, max = 160): string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.length > max ||
		Array.from(value).some(
			(char) =>
				char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)),
		)
	)
		throw new Invalid();
	return value;
}
function identifier(value: unknown): string {
	const result = string(value);
	if (!/^[A-Za-z0-9_-]+$/u.test(result)) throw new Invalid();
	return result;
}
function hash(value: unknown): string {
	const result = string(value, 64);
	if (!SHA256.test(result)) throw new Invalid();
	return result;
}
function seconds(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 604800
	)
		throw new Invalid();
	return value;
}
export const sha256 = (value: string) =>
	createHash("sha256").update(value, "utf8").digest("hex");

/** Verify the exact Python-produced UTF-8 strings; JS must not reserialize Python floats. */
export function prepareImport(
	raw: string,
): { ok: true; value: PreparedImport } | { ok: false; reason: ImportFailure } {
	try {
		if (Buffer.byteLength(raw, "utf8") > MAX_IMPORT_BYTES)
			throw new Invalid("too_large");
		const request = object(JSON.parse(raw));
		keys(request, ["schemaVersion", "result"]);
		if (request.schemaVersion !== IMPORT_VERSION)
			throw new Invalid("unsupported_version");
		const result = object(request.result);
		keys(result, [
			"schema_version",
			"campaign_id",
			"session_id",
			"source_id",
			"job_id",
			"publication_bundle",
			"import_artifacts",
			"sync",
		]);
		if (result.schema_version !== "tda_local_result_v1")
			throw new Invalid("unsupported_version");
		const campaignId = identifier(result.campaign_id);
		const sessionId = string(result.session_id);
		if (!UUID.test(sessionId) || !UUID.test(campaignId)) throw new Invalid();
		const sourceSessionId = identifier(result.source_id);
		const jobId = identifier(result.job_id);
		const bundle = object(result.publication_bundle);
		const { publication_id, generated_at, ...payload } = bundle;
		const publicationId = hash(publication_id);
		if (!Number.isFinite(Date.parse(string(generated_at)))) throw new Invalid();
		keys(payload, [
			"schema_version",
			"session",
			"recap",
			"approved_entries",
			"open_threads",
			"source_manifest",
		]);
		if (payload.schema_version !== "publication_bundle_v1")
			throw new Invalid("unsupported_version");
		if (!result.import_artifacts) throw new Invalid("transcript_required");
		const artifacts = object(result.import_artifacts);
		keys(artifacts, ["publication_payload_json", "transcript_json"]);
		const publicationJson = string(
			artifacts.publication_payload_json,
			MAX_IMPORT_BYTES,
		);
		if (
			typeof artifacts.transcript_json !== "string" ||
			!artifacts.transcript_json.trim()
		)
			throw new Invalid("transcript_required");
		const transcriptJson = string(artifacts.transcript_json, MAX_IMPORT_BYTES);
		if (
			sha256(publicationJson) !== publicationId ||
			!isDeepStrictEqual(JSON.parse(publicationJson), payload)
		)
			throw new Invalid("hash_mismatch");
		const session = object(payload.session);
		keys(session, [
			"source_id",
			"played_at",
			"start_time",
			"title",
			"speakers",
		]);
		if (session.source_id !== sourceSessionId) throw new Invalid();
		for (const field of ["played_at", "start_time", "title"])
			if (session[field] !== null) string(session[field], 500);
		if (!Array.isArray(session.speakers) || session.speakers.length > 100)
			throw new Invalid();
		for (const speaker of session.speakers) string(speaker);
		// This boundary accepts evidence only; editorial content must stay in the Edit workflow.
		const recap = object(payload.recap);
		keys(recap, ["short", "full"]);
		if (
			recap.short !== null ||
			recap.full !== null ||
			!Array.isArray(payload.approved_entries) ||
			payload.approved_entries.length ||
			!Array.isArray(payload.open_threads) ||
			payload.open_threads.length
		)
			throw new Invalid();
		const manifest = object(payload.source_manifest);
		keys(manifest, [
			"local_only",
			"recording_format",
			"transcript_segments",
			"duration_seconds",
			"transcript_sha256",
			"manifest_sha256",
		]);
		if (manifest.local_only !== true) throw new Invalid();
		if (string(manifest.recording_format) === "synthetic.fixture")
			throw new Invalid("synthetic_payload");
		const transcriptSha256 = hash(manifest.transcript_sha256);
		const manifestSha256 = hash(manifest.manifest_sha256);
		if (sha256(transcriptJson) !== transcriptSha256)
			throw new Invalid("hash_mismatch");
		const timeline: unknown = JSON.parse(transcriptJson);
		if (Array.isArray(timeline) && !timeline.length)
			throw new Invalid("transcript_required");
		if (
			!Array.isArray(timeline) ||
			timeline.length > MAX_SEGMENTS ||
			timeline.length !== manifest.transcript_segments
		)
			throw new Invalid();
		const ids = new Set<string>();
		const segments = timeline.map((value: unknown) => {
			const row = object(value);
			keys(row, ["id", "speaker", "track", "start", "end", "text", "words"]);
			const sourceSegmentId = string(row.id);
			if (ids.has(sourceSegmentId)) throw new Invalid();
			ids.add(sourceSegmentId);
			const start = seconds(row.start),
				end = seconds(row.end);
			if (end < start) throw new Invalid();
			const trackKey = string(row.track);
			if (/[\\/:]/u.test(trackKey) || trackKey === "." || trackKey === "..")
				throw new Invalid();
			if (!Array.isArray(row.words) || row.words.length > 3000)
				throw new Invalid();
			for (const value of row.words) {
				const word = object(value);
				keys(word, ["word", "start", "end", "probability"]);
				string(word.word, 1000);
				if (
					seconds(word.end) < seconds(word.start) ||
					typeof word.probability !== "number" ||
					!Number.isFinite(word.probability) ||
					word.probability < 0 ||
					word.probability > 1
				)
					throw new Invalid();
			}
			return {
				sourceSegmentId,
				startMs: Math.round(start * 1000),
				endMs: Math.round(end * 1000),
				text: string(row.text, 10000),
				speakerName: string(row.speaker),
				trackKey,
			};
		});
		if (
			Math.round(seconds(manifest.duration_seconds) * 1000) !==
			Math.max(...segments.map((s) => s.endMs))
		)
			throw new Invalid();
		return {
			ok: true,
			value: {
				campaignId,
				sessionId,
				sourceSystem: "local_companion",
				sourceSessionId,
				jobId,
				publicationId,
				transcriptSha256,
				manifestSha256,
				segments,
			},
		};
	} catch (error) {
		return {
			ok: false,
			reason: error instanceof Invalid ? error.reason : "invalid_payload",
		};
	}
}
