import { parseTrustedAbsoluteTime, wallClockPresentation, type TrustedAbsoluteTime } from "./time-contract";
import { isReviewStringV1 } from "./text-contract";

export const TRANSCRIPT_MARKDOWN_SCHEMA = 1 as const;
export const TRANSCRIPT_MARKDOWN_MAX_BYTES = 32 * 1024 * 1024;
export const TRANSCRIPT_MARKDOWN_MAX_SEGMENTS = 100_000;
const MAX_FRONTMATTER_LINES = 32;
const MAX_LINE_CHARS = 4096;

export type TranscriptMarkdownBaseKind =
	| "local_run"
	| "session_assembly"
	| "cloud_revision";

export type TranscriptMarkdownBase = Readonly<{
	sessionId: string;
	baseKind: TranscriptMarkdownBaseKind;
	baseId: string;
	baseRevision: number | null;
	baseSha256: string;
}>;

export type TranscriptMarkdownSegment = Readonly<{
	id: string;
	startMs: number;
	endMs: number;
	absoluteTime?: TrustedAbsoluteTime | null;
	speaker: string;
	text: string;
}>;

export type TranscriptMarkdownChange = Readonly<{
	id: string;
	startMs: number;
	beforeSpeaker: string;
	afterSpeaker: string;
	beforeText: string;
	afterText: string;
	speakerChanged: boolean;
	textChanged: boolean;
}>;

export type TranscriptMarkdownImport = Readonly<{
	segments: readonly TranscriptMarkdownSegment[];
	changes: readonly TranscriptMarkdownChange[];
	changedSegments: number;
	speakerChanges: number;
	textChanges: number;
	unchangedSegments: number;
	structureSha256: string;
}>;

export class TranscriptMarkdownError extends Error {
	constructor(
		public readonly code:
			| "FILE_TOO_LARGE"
			| "UTF8_INVALID"
			| "FRONTMATTER_INVALID"
			| "SCHEMA_UNSUPPORTED"
			| "BASE_MISMATCH"
			| "STRUCTURE_HASH_MISMATCH"
			| "SEGMENT_COUNT_INVALID"
			| "MARKER_INVALID"
			| "MARKER_DUPLICATE"
			| "MARKER_UNKNOWN"
			| "MARKER_MISSING"
			| "SEGMENT_REORDERED"
			| "TIMING_CHANGED"
			| "VISIBLE_TIMESTAMP_CHANGED"
			| "SPEAKER_INVALID"
			| "TEXT_INVALID",
		message: string = code,
		public readonly details: Readonly<Record<string, string | number>> = {},
	) {
		super(message);
		this.name = "TranscriptMarkdownError";
	}
}

function normalizeNewlines(value: string): string {
	return value.replace(/\r\n?/gu, "\n");
}

function canonicalEditableText(value: string): string {
	return normalizeNewlines(value).trim();
}

function assertIdentity(value: string, field: string, maximum = 512): void {
	if (
		!value ||
		value.length > maximum ||
		value.includes("\0") ||
		Array.from(value).some((char) => {
			const code = char.codePointAt(0) as number;
			return (code >= 0xd800 && code <= 0xdfff) || code === 127 || code < 32;
		})
	)
		throw new TranscriptMarkdownError("FRONTMATTER_INVALID", field);
}

function assertSha256(value: string, field: string): void {
	if (!/^[0-9a-f]{64}$/u.test(value))
		throw new TranscriptMarkdownError("FRONTMATTER_INVALID", field);
}

function assertMs(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new TranscriptMarkdownError("MARKER_INVALID", field);
}

function trustedSegmentAbsoluteTime(
	segment: Pick<TranscriptMarkdownSegment, "absoluteTime" | "id">,
): TrustedAbsoluteTime | null {
	if (!segment.absoluteTime) return null;
	const parsed = parseTrustedAbsoluteTime({
		state: "trusted_absolute",
		start: segment.absoluteTime.startIso,
		end: segment.absoluteTime.endIso,
		source: segment.absoluteTime.source,
	});
	if (
		!parsed ||
		parsed.startIso !== segment.absoluteTime.startIso ||
		parsed.endIso !== segment.absoluteTime.endIso ||
		parsed.source !== segment.absoluteTime.source
	)
		throw new TranscriptMarkdownError("TIMING_CHANGED", "invalid trusted absolute time", {
			id: segment.id,
		});
	return parsed;
}

function sameAbsoluteTime(
	a: TrustedAbsoluteTime | null | undefined,
	b: TrustedAbsoluteTime | null | undefined,
): boolean {
	if (!a || !b) return !a && !b;
	return a.startIso === b.startIso && a.endIso === b.endIso && a.source === b.source;
}

function formatTimestamp(milliseconds: number): string {
	const hours = Math.floor(milliseconds / 3_600_000);
	const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
	const seconds = Math.floor((milliseconds % 60_000) / 1000);
	return (
		String(hours).padStart(2, "0") +
		":" +
		String(minutes).padStart(2, "0") +
		":" +
		String(seconds).padStart(2, "0") +
		"." +
		String(milliseconds % 1000).padStart(3, "0")
	);
}

function parseTimestamp(value: string): number | null {
	const match = /^(\d{2,6}):([0-5]\d):([0-5]\d)\.(\d{3})$/u.exec(value);
	if (!match) return null;
	const result =
		((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 +
		Number(match[4]);
	return Number.isSafeInteger(result) ? result : null;
}

function escapeSpeaker(value: string): string {
	return value.replace(/\\/gu, "\\\\").replace(/\*/gu, "\\*");
}

function unescapeSpeaker(value: string): string {
	let result = "";
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (char === "\\" && index + 1 < value.length) {
			const next = value[index + 1];
			if (next === "\\" || next === "*") {
				result += next;
				index += 1;
				continue;
			}
		}
		result += char;
	}
	return result;
}

function validateBase(base: TranscriptMarkdownBase): void {
	assertIdentity(base.sessionId, "session_id", 128);
	if (!["local_run", "session_assembly", "cloud_revision"].includes(base.baseKind))
		throw new TranscriptMarkdownError("FRONTMATTER_INVALID", "base_kind");
	assertIdentity(base.baseId, "base_id", 1024);
	if (
		base.baseRevision !== null &&
		(!Number.isSafeInteger(base.baseRevision) || base.baseRevision < 0)
	)
		throw new TranscriptMarkdownError("FRONTMATTER_INVALID", "base_revision");
	assertSha256(base.baseSha256, "base_sha256");
}

function validateSegments(
	segments: readonly TranscriptMarkdownSegment[],
	validateEditable = true,
): void {
	if (segments.length < 1 || segments.length > TRANSCRIPT_MARKDOWN_MAX_SEGMENTS)
		throw new TranscriptMarkdownError("SEGMENT_COUNT_INVALID");
	const seen = new Set<string>();
	for (const segment of segments) {
		assertIdentity(segment.id, "segment.id", 1024);
		if (seen.has(segment.id))
			throw new TranscriptMarkdownError("MARKER_DUPLICATE", "duplicate id", {
				id: segment.id,
			});
		seen.add(segment.id);
		assertMs(segment.startMs, "segment.start_ms");
		assertMs(segment.endMs, "segment.end_ms");
		if (segment.endMs < segment.startMs)
			throw new TranscriptMarkdownError("TIMING_CHANGED", "end before start", {
				id: segment.id,
			});
		trustedSegmentAbsoluteTime(segment);
		if (!validateEditable) continue;
		if (!isReviewStringV1(segment.speaker, "speaker"))
			throw new TranscriptMarkdownError("SPEAKER_INVALID", "speaker invalid", {
				id: segment.id,
			});
		if (!isReviewStringV1(segment.text, "text"))
			throw new TranscriptMarkdownError("TEXT_INVALID", "text invalid", {
				id: segment.id,
			});
		if (
			normalizeNewlines(segment.text)
				.split("\n")
				.some((line) => line.startsWith("<!-- tda:segment "))
		)
			throw new TranscriptMarkdownError("TEXT_INVALID", "reserved marker in text", {
				id: segment.id,
			});
	}
}

function canonicalStructure(
	base: TranscriptMarkdownBase,
	segments: readonly Pick<TranscriptMarkdownSegment, "id" | "startMs" | "endMs" | "absoluteTime">[],
): string {
	return JSON.stringify({
		schema: TRANSCRIPT_MARKDOWN_SCHEMA,
		session_id: base.sessionId,
		base_kind: base.baseKind,
		base_id: base.baseId,
		base_revision: base.baseRevision,
		base_sha256: base.baseSha256,
		segments: segments.map((segment) => {
			const absoluteTime = trustedSegmentAbsoluteTime(segment);
			return {
				id: segment.id,
				start_ms: segment.startMs,
				end_ms: segment.endMs,
				...(absoluteTime
					? {
							absolute_start: absoluteTime.startIso,
							absolute_end: absoluteTime.endIso,
							absolute_source: absoluteTime.source,
						}
					: {}),
			};
		}),
	});
}

async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function transcriptMarkdownStructureSha256(
	base: TranscriptMarkdownBase,
	segments: readonly Pick<TranscriptMarkdownSegment, "id" | "startMs" | "endMs">[],
): Promise<string> {
	validateBase(base);
	if (segments.length < 1 || segments.length > TRANSCRIPT_MARKDOWN_MAX_SEGMENTS)
		throw new TranscriptMarkdownError("SEGMENT_COUNT_INVALID");
	return sha256Hex(canonicalStructure(base, segments));
}

export async function transcriptMarkdownContentSha256(
	segments: readonly TranscriptMarkdownSegment[],
): Promise<string> {
	validateSegments(segments);
	return sha256Hex(
		JSON.stringify(
			segments.map((segment) => {
				const absoluteTime = trustedSegmentAbsoluteTime(segment);
				return {
					id: segment.id,
					start_ms: segment.startMs,
					end_ms: segment.endMs,
					...(absoluteTime
						? {
								absolute_start: absoluteTime.startIso,
								absolute_end: absoluteTime.endIso,
								absolute_source: absoluteTime.source,
							}
						: {}),
					speaker: canonicalEditableText(segment.speaker),
					text: canonicalEditableText(segment.text),
				};
			}),
		),
	);
}

export async function renderTranscriptMarkdownV1(input: {
	base: TranscriptMarkdownBase;
	segments: readonly TranscriptMarkdownSegment[];
	title?: string;
	exportedAt?: string;
}): Promise<string> {
	validateBase(input.base);
	validateSegments(input.segments);
	const structureSha256 = await transcriptMarkdownStructureSha256(input.base, input.segments);
	const exportedAt = input.exportedAt ?? new Date().toISOString();
	if (!Number.isFinite(Date.parse(exportedAt)))
		throw new TranscriptMarkdownError("FRONTMATTER_INVALID", "exported_at");
	const lines = [
		"---",
		"tda_transcript_schema: 1",
		"session_id: " + JSON.stringify(input.base.sessionId),
		"base_kind: " + JSON.stringify(input.base.baseKind),
		"base_id: " + JSON.stringify(input.base.baseId),
		"base_revision: " + JSON.stringify(input.base.baseRevision),
		"base_sha256: " + JSON.stringify(input.base.baseSha256),
		"structure_sha256: " + JSON.stringify(structureSha256),
		"exported_at: " + JSON.stringify(exportedAt),
		"timebase: " + JSON.stringify("elapsed"),
		"---",
		"",
		"# Transcrição — " + (canonicalEditableText(input.title ?? "Transcrição") || "Transcrição"),
		"",
		"> Edite apenas nomes e texto das falas.",
		"> Preserve os comentários tda:segment, timestamps, ordem e quantidade de falas.",
		"",
		"## Transcrição",
		"",
	];
	for (const segment of input.segments) {
		const absoluteTime = trustedSegmentAbsoluteTime(segment);
		const wallClock = absoluteTime ? wallClockPresentation(absoluteTime.startIso) : null;
		const marker =
			"<!-- tda:segment id=" +
			JSON.stringify(segment.id) +
			' start_ms="' +
			segment.startMs +
			'" end_ms="' +
			segment.endMs +
			'"' +
			(absoluteTime
				? " absolute_start=" +
					JSON.stringify(absoluteTime.startIso) +
					" absolute_end=" +
					JSON.stringify(absoluteTime.endIso) +
					" absolute_source=" +
					JSON.stringify(absoluteTime.source)
				: "") +
			" -->";
		const visibleTime =
			formatTimestamp(segment.startMs) + (wallClock ? " | " + wallClock.clock : "");
		lines.push(
			marker,
			"[" + visibleTime + "] **" + escapeSpeaker(canonicalEditableText(segment.speaker)) + "**",
			canonicalEditableText(segment.text),
			"",
		);
	}
	const output = lines.join("\n").trimEnd() + "\n";
	if (new TextEncoder().encode(output).byteLength > TRANSCRIPT_MARKDOWN_MAX_BYTES)
		throw new TranscriptMarkdownError("FILE_TOO_LARGE");
	return output;
}

function parseScalar(value: string): string | number | null {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (typeof parsed === "string" || typeof parsed === "number" || parsed === null)
			return parsed;
	} catch {
		// mapped below
	}
	throw new TranscriptMarkdownError("FRONTMATTER_INVALID");
}

function parseFrontmatter(lines: readonly string[]) {
	if (lines[0] !== "---") throw new TranscriptMarkdownError("FRONTMATTER_INVALID");
	const values = new Map<string, string | number | null>();
	let bodyStart = -1;
	for (let index = 1; index <= Math.min(lines.length - 1, MAX_FRONTMATTER_LINES); index += 1) {
		const line = lines[index];
		if (line === "---") {
			bodyStart = index + 1;
			break;
		}
		if (line.length > MAX_LINE_CHARS) throw new TranscriptMarkdownError("FRONTMATTER_INVALID");
		const separator = line.indexOf(":");
		if (separator < 1) throw new TranscriptMarkdownError("FRONTMATTER_INVALID");
		const key = line.slice(0, separator);
		const raw = line.slice(separator + 1).trim();
		const allowed = [
			"tda_transcript_schema",
			"session_id",
			"base_kind",
			"base_id",
			"base_revision",
			"base_sha256",
			"structure_sha256",
			"exported_at",
			"timebase",
		];
		if (!allowed.includes(key) || values.has(key))
			throw new TranscriptMarkdownError("FRONTMATTER_INVALID", key);
		values.set(key, key === "tda_transcript_schema" ? Number(raw) : parseScalar(raw));
	}
	if (bodyStart < 0) throw new TranscriptMarkdownError("FRONTMATTER_INVALID");
	if (values.get("tda_transcript_schema") !== TRANSCRIPT_MARKDOWN_SCHEMA)
		throw new TranscriptMarkdownError("SCHEMA_UNSUPPORTED");
	if (values.get("timebase") !== "elapsed")
		throw new TranscriptMarkdownError("FRONTMATTER_INVALID", "timebase");
	const exportedAt = values.get("exported_at");
	if (typeof exportedAt !== "string" || !Number.isFinite(Date.parse(exportedAt)))
		throw new TranscriptMarkdownError("FRONTMATTER_INVALID", "exported_at");
	const rawRevision = values.get("base_revision");
	const base: TranscriptMarkdownBase = {
		sessionId: typeof values.get("session_id") === "string" ? String(values.get("session_id")) : "",
		baseKind: typeof values.get("base_kind") === "string" ? String(values.get("base_kind")) as TranscriptMarkdownBaseKind : "" as TranscriptMarkdownBaseKind,
		baseId: typeof values.get("base_id") === "string" ? String(values.get("base_id")) : "",
		baseRevision: rawRevision === null ? null : typeof rawRevision === "number" ? rawRevision : Number.NaN,
		baseSha256: typeof values.get("base_sha256") === "string" ? String(values.get("base_sha256")) : "",
	};
	validateBase(base);
	const structureSha256 = values.get("structure_sha256");
	if (typeof structureSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(structureSha256))
		throw new TranscriptMarkdownError("FRONTMATTER_INVALID", "structure_sha256");
	return { base, structureSha256, bodyStart };
}

function parseMarker(line: string): {
	id: string;
	startMs: number;
	endMs: number;
	absoluteTime?: TrustedAbsoluteTime;
} | null {
	if (!line.startsWith("<!-- tda:segment ")) return null;
	if (line.length > MAX_LINE_CHARS) throw new TranscriptMarkdownError("MARKER_INVALID");
	const jsonString = '("(?:\\\\.|[^"\\\\])*")';
	const pattern = new RegExp(
		'^<!-- tda:segment id=' +
			jsonString +
			' start_ms="(\\d{1,16})" end_ms="(\\d{1,16})"' +
			'(?: absolute_start=' +
			jsonString +
			' absolute_end=' +
			jsonString +
			' absolute_source=' +
			jsonString +
			')? -->$',
		"u",
	);
	const match = pattern.exec(line);
	if (!match) throw new TranscriptMarkdownError("MARKER_INVALID");
	let id: unknown;
	let absoluteStart: unknown;
	let absoluteEnd: unknown;
	let absoluteSource: unknown;
	try {
		id = JSON.parse(match[1]);
		if (match[4] !== undefined) {
			absoluteStart = JSON.parse(match[4]);
			absoluteEnd = JSON.parse(match[5]);
			absoluteSource = JSON.parse(match[6]);
		}
	} catch {
		throw new TranscriptMarkdownError("MARKER_INVALID");
	}
	if (typeof id !== "string") throw new TranscriptMarkdownError("MARKER_INVALID");
	assertIdentity(id, "segment.id", 1024);
	const startMs = Number(match[2]);
	const endMs = Number(match[3]);
	assertMs(startMs, "segment.start_ms");
	assertMs(endMs, "segment.end_ms");
	if (endMs < startMs)
		throw new TranscriptMarkdownError("TIMING_CHANGED", "end before start", { id });
	if (match[4] === undefined) return { id, startMs, endMs };
	const absoluteTime = parseTrustedAbsoluteTime({
		state: "trusted_absolute",
		start: absoluteStart,
		end: absoluteEnd,
		source: absoluteSource,
	});
	if (!absoluteTime)
		throw new TranscriptMarkdownError("TIMING_CHANGED", "invalid trusted absolute time", {
			id,
		});
	return { id, startMs, endMs, absoluteTime };
}

function parseHeader(
	line: string,
	expectedStartMs: number,
	expectedAbsoluteTime?: TrustedAbsoluteTime | null,
): string {
	if (line.length > MAX_LINE_CHARS) throw new TranscriptMarkdownError("SPEAKER_INVALID");
	const match = /^\[([^\]]{1,96})\] \*\*(.*)\*\*$/u.exec(line);
	if (!match) throw new TranscriptMarkdownError("SPEAKER_INVALID");
	const visibleParts = match[1].split(" | ");
	if (
		visibleParts.length < 1 ||
		visibleParts.length > 2 ||
		parseTimestamp(visibleParts[0]) !== expectedStartMs
	)
		throw new TranscriptMarkdownError("VISIBLE_TIMESTAMP_CHANGED");
	const expectedWallClock = expectedAbsoluteTime
		? wallClockPresentation(expectedAbsoluteTime.startIso)?.clock ?? null
		: null;
	if (
		(expectedWallClock === null && visibleParts.length !== 1) ||
		(expectedWallClock !== null &&
			(visibleParts.length !== 2 || visibleParts[1] !== expectedWallClock))
	)
		throw new TranscriptMarkdownError("VISIBLE_TIMESTAMP_CHANGED");
	const speaker = canonicalEditableText(unescapeSpeaker(match[2]));
	if (!isReviewStringV1(speaker, "speaker"))
		throw new TranscriptMarkdownError("SPEAKER_INVALID");
	return speaker;
}

function sameBase(a: TranscriptMarkdownBase, b: TranscriptMarkdownBase): boolean {
	return a.sessionId === b.sessionId &&
		a.baseKind === b.baseKind &&
		a.baseId === b.baseId &&
		a.baseRevision === b.baseRevision &&
		a.baseSha256 === b.baseSha256;
}

export function decodeTranscriptMarkdownBytes(bytes: Uint8Array): string {
	if (bytes.byteLength > TRANSCRIPT_MARKDOWN_MAX_BYTES)
		throw new TranscriptMarkdownError("FILE_TOO_LARGE");
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new TranscriptMarkdownError("UTF8_INVALID");
	}
}

export async function parseTranscriptMarkdownV1(input: {
	text: string;
	expectedBase: TranscriptMarkdownBase;
	expectedSegments: readonly TranscriptMarkdownSegment[];
}): Promise<TranscriptMarkdownImport> {
	const normalized = normalizeNewlines(input.text);
	if (new TextEncoder().encode(normalized).byteLength > TRANSCRIPT_MARKDOWN_MAX_BYTES)
		throw new TranscriptMarkdownError("FILE_TOO_LARGE");
	validateBase(input.expectedBase);
	validateSegments(input.expectedSegments);
	const lines = normalized.split("\n");
	const frontmatter = parseFrontmatter(lines);
	if (!sameBase(frontmatter.base, input.expectedBase))
		throw new TranscriptMarkdownError("BASE_MISMATCH");

	const expectedById = new Map(input.expectedSegments.map((segment) => [segment.id, segment] as const));
	const parsed: TranscriptMarkdownSegment[] = [];
	const seen = new Set<string>();
	let index = frontmatter.bodyStart;
	while (index < lines.length) {
		const marker = parseMarker(lines[index]);
		if (!marker) {
			index += 1;
			continue;
		}
		if (seen.has(marker.id))
			throw new TranscriptMarkdownError("MARKER_DUPLICATE", "duplicate id", { id: marker.id });
		const expected = expectedById.get(marker.id);
		if (!expected)
			throw new TranscriptMarkdownError("MARKER_UNKNOWN", "unknown id", { id: marker.id });
		seen.add(marker.id);
		if (input.expectedSegments[parsed.length]?.id !== marker.id)
			throw new TranscriptMarkdownError("SEGMENT_REORDERED", "segment order changed", { id: marker.id });
		if (
			marker.startMs !== expected.startMs ||
			marker.endMs !== expected.endMs ||
			!sameAbsoluteTime(marker.absoluteTime, expected.absoluteTime)
		)
			throw new TranscriptMarkdownError("TIMING_CHANGED", "timing changed", { id: marker.id });
		index += 1;
		if (index >= lines.length) throw new TranscriptMarkdownError("SPEAKER_INVALID");
		const speaker = parseHeader(lines[index], marker.startMs, marker.absoluteTime);
		index += 1;
		const textLines: string[] = [];
		while (index < lines.length && !lines[index].startsWith("<!-- tda:segment ")) {
			textLines.push(lines[index]);
			index += 1;
		}
		while (textLines.length && textLines[textLines.length - 1] === "") textLines.pop();
		const text = canonicalEditableText(textLines.join("\n"));
		if (!isReviewStringV1(text, "text"))
			throw new TranscriptMarkdownError("TEXT_INVALID", "text invalid", { id: marker.id });
		parsed.push({
			id: marker.id,
			startMs: marker.startMs,
			endMs: marker.endMs,
			...(marker.absoluteTime ? { absoluteTime: marker.absoluteTime } : {}),
			speaker,
			text,
		});
	}
	if (parsed.length !== input.expectedSegments.length)
		throw new TranscriptMarkdownError("MARKER_MISSING", "missing markers", {
			expected: input.expectedSegments.length,
			found: parsed.length,
			missing: input.expectedSegments.length - parsed.length,
		});

	const actualHash = await transcriptMarkdownStructureSha256(frontmatter.base, parsed);
	const expectedHash = await transcriptMarkdownStructureSha256(input.expectedBase, input.expectedSegments);
	if (actualHash !== frontmatter.structureSha256 || actualHash !== expectedHash)
		throw new TranscriptMarkdownError("STRUCTURE_HASH_MISMATCH");

	const changes: TranscriptMarkdownChange[] = [];
	let speakerChanges = 0;
	let textChanges = 0;
	for (let position = 0; position < parsed.length; position += 1) {
		const before = input.expectedSegments[position];
		const after = parsed[position];
		const speakerChanged = before.speaker !== after.speaker;
		const textChanged = canonicalEditableText(before.text) !== canonicalEditableText(after.text);
		if (!speakerChanged && !textChanged) continue;
		if (speakerChanged) speakerChanges += 1;
		if (textChanged) textChanges += 1;
		changes.push({
			id: after.id,
			startMs: after.startMs,
			beforeSpeaker: before.speaker,
			afterSpeaker: after.speaker,
			beforeText: before.text,
			afterText: after.text,
			speakerChanged,
			textChanged,
		});
	}
	return {
		segments: parsed,
		changes,
		changedSegments: changes.length,
		speakerChanges,
		textChanges,
		unchangedSegments: parsed.length - changes.length,
		structureSha256: actualHash,
	};
}
